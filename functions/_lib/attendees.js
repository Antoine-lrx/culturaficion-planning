// Helpers partagés par les endpoints des inscrits d'un événement
// (/api/events/:id/attendees/* et /api/attendees/:id).
//
// RGPD : ces endpoints manipulent des données personnelles (prénom, nom,
// email). Règles appliquées partout :
//   - aucune donnée personnelle dans les logs (pas de console.log sur un nom
//     ou un email, seulement des statuts HTTP) ;
//   - chaque réponse porte Cache-Control: no-store ;
//   - purge automatique 12 mois après l'événement, au début de chaque appel ;
//   - la liste d'opposition ne contient que des empreintes SHA-256.
import { json } from "./http.js";
import { HELLOASSO_API_BASE as API_BASE } from "./helloasso.js";
import { currentSeasonKey, seasonFromSlug } from "./season.js";
import { normalizePersonName, normalizeEmail } from "./people.js";

// Libellés EXACTS (après normalisation) d'une question personnalisée de
// billetterie contenant l'email du participant. Convenu avec le bureau : pour
// demander l'email de chaque participant sur une billetterie, ajouter une
// question au libellé « Email du participant ». Aucun autre champ n'est
// deviné (égalité stricte, jamais includes/startsWith).
export const PARTICIPANT_EMAIL_LABELS = ["Email du participant"];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_SIZE = 100;
// Garde-fou : nombre limité de sous-requêtes par invocation Pages Function.
const MAX_PAGES = 20;
// Clé meta (aucune donnée personnelle) : date de la dernière récupération et
// nombre de dons du formulaire, par événement.
export const lastSyncKey = (eventId) => `attendees_last_sync:${eventId}`;

export function jsonNoStore(data, init = {}) {
  return json(data, { ...init, headers: { "cache-control": "no-store", ...(init.headers || {}) } });
}

export function normalizeLabel(label) {
  return String(label || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
const PARTICIPANT_EMAIL_KEYS = new Set(PARTICIPANT_EMAIL_LABELS.map(normalizeLabel));
export const isParticipantEmailField = (cf) => PARTICIPANT_EMAIL_KEYS.has(normalizeLabel(cf && cf.name));

// Empreinte SHA-256 (hexadécimal) de l'email normalisé : seule forme sous
// laquelle une adresse entre dans la liste d'opposition.
export async function emailHash(email) {
  const data = new TextEncoder().encode(normalizeEmail(email));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadOptouts(env) {
  const rows = await env.DB.prepare("SELECT email_hash FROM contact_optouts").all();
  return new Set(rows.results.map((r) => r.email_hash));
}

// Purge RGPD : supprime les inscrits des événements passés depuis plus de
// 12 mois (date précise, sinon fin du mois de l'événement), ainsi que ceux
// d'un événement qui n'existe plus. N'écrit rien s'il n'y a rien à purger.
export async function purgeExpired(env, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  const cutoffDate = cutoff.toISOString().slice(0, 10); // AAAA-MM-JJ
  const cutoffMonth = cutoffDate.slice(0, 7);            // AAAA-MM
  await env.DB.prepare(
    `DELETE FROM event_attendees
      WHERE event_id NOT IN (SELECT id FROM events)
         OR event_id IN (
              SELECT id FROM events
               WHERE (date IS NOT NULL AND date <> '' AND date < ?1)
                  OR ((date IS NULL OR date = '') AND month_key < ?2))`
  ).bind(cutoffDate, cutoffMonth).run();
}

// Lit tous les articles d'un formulaire HelloAsso, en paginant. Pour un
// formulaire d'événement on n'applique pas de filtre d'état (même appel que
// les chiffres du bilan) : le tri est fait par l'appelant.
export async function fetchFormItems(env, token, formType, formSlug, { withDetails = false, states = [] } = {}) {
  const out = [];
  let continuationToken = "";
  let page = 0;
  do {
    page += 1;
    const url = new URL(`${API_BASE}/organizations/${env.HELLOASSO_ORG_SLUG}/forms/${formType}/${formSlug}/items`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (withDetails) url.searchParams.set("withDetails", "true");
    for (const s of states) url.searchParams.append("itemStates", s);
    if (continuationToken) url.searchParams.set("continuationToken", continuationToken);

    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HelloAsso ${formType} : statut ${res.status}`);
    const data = await res.json();
    const items = data.data || [];
    out.push(...items);
    // Le continuationToken est renvoyé même sur la dernière page : le signal
    // fiable de fin est une page plus courte que la taille demandée.
    continuationToken =
      items.length === PAGE_SIZE ? (data.pagination && data.pagination.continuationToken) || "" : "";
  } while (continuationToken && page < MAX_PAGES);
  return out;
}

// Emails des adhérents de la saison EN COURS, lus en direct sur le formulaire
// d'adhésion HelloAsso (jamais stockés). On ne retient que les adhésions où
// l'adhérent est lui-même le payeur, hors pierres tombales RGPD. Renvoie null
// si le formulaire configuré n'est pas celui de la saison en cours (ex. en
// septembre, avant la mise à jour du slug) : seul le nom sert alors.
export async function fetchMemberEmails(env, token) {
  const formSlug = env.HELLOASSO_MEMBERSHIP_FORM_SLUG;
  if (!formSlug || seasonFromSlug(formSlug) !== currentSeasonKey()) return null;

  const tomb = await env.DB.prepare(
    "SELECT helloasso_item_id FROM memberships WHERE source = 'helloasso' AND is_deleted = 1"
  ).all();
  const tombstoned = new Set(tomb.results.map((r) => String(r.helloasso_item_id)));

  const items = await fetchFormItems(env, token, "Membership", formSlug, { states: ["Processed", "Registered"] });
  const emails = new Set();
  for (const it of items) {
    if (it.type && it.type !== "Membership") continue;
    if (tombstoned.has(String(it.id))) continue;
    const u = it.user || {};
    const p = it.payer || {};
    if (!p.email) continue;
    if (normalizePersonName(u.firstName, u.lastName) !== normalizePersonName(p.firstName, p.lastName)) continue;
    emails.add(normalizeEmail(p.email));
  }
  return emails;
}

// Prénom + nom normalisés des adhérents de la saison en cours (table
// memberships, tous types, hors lignes supprimées).
export async function loadMemberNames(env) {
  const rows = await env.DB.prepare(
    "SELECT first_name, last_name FROM memberships WHERE season_key = ? AND is_deleted = 0"
  ).bind(currentSeasonKey()).all();
  const names = new Set();
  for (const r of rows.results) {
    const key = normalizePersonName(r.first_name, r.last_name);
    if (key) names.add(key);
  }
  return names;
}

export function rowToAttendee(row) {
  return {
    id: row.id,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    email: row.email || null,
    emailSource: row.email_source || null,
    payerName: row.payer_name || null,
    isMember: !!row.is_member,
    memberMatch: row.member_match || null,
    followUpStatus: row.follow_up_status || null,
    followedUpAt: row.followed_up_at || null,
    absent: !!row.absent,
  };
}

export const isToFollowUp = (r) => !r.is_member && !r.absent && r.follow_up_status === "a_relancer";

// Liste enregistrée d'un événement + compteurs + date de dernière récupération.
export async function loadList(env, eventId, extra = {}) {
  const rows = await env.DB.prepare(
    "SELECT * FROM event_attendees WHERE event_id = ? ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE"
  ).bind(eventId).all();
  const list = rows.results;
  const meta = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(lastSyncKey(eventId)).first();
  let lastSync = null;
  let donations = 0;
  if (meta?.value) {
    try {
      const v = JSON.parse(meta.value);
      lastSync = v.at || null;
      donations = Number(v.donations) || 0;
    } catch {
      /* valeur illisible : ignorée */
    }
  }
  const members = list.filter((r) => r.is_member).length;
  return {
    attendees: list.map(rowToAttendee),
    counts: {
      registered: list.length,
      members,
      nonMembers: list.length - members,
      toFollowUp: list.filter(isToFollowUp).length,
    },
    lastSync: list.length ? lastSync : null,
    donations: list.length ? donations : 0,
    ...extra,
  };
}
