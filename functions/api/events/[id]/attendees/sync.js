import { isAuthorized, unauthorized } from "../../../../_lib/auth.js";
import { getAccessToken } from "../../../../_lib/helloasso.js";
import { normalizePersonName, normalizeEmail } from "../../../../_lib/people.js";
import {
  jsonNoStore, purgeExpired, fetchFormItems, fetchMemberEmails, loadMemberNames, loadOptouts,
  emailHash, isParticipantEmailField, loadList, lastSyncKey, EMAIL_RE,
} from "../../../../_lib/attendees.js";

// États d'article retenus : payé et valide (Processed) ou saisi à la main par
// l'association (Registered). Un billet dont tous les paiements sont
// remboursés ou annulés est exclu.
const VALID_STATES = new Set(["Processed", "Registered"]);
const VOID_PAYMENT_STATES = new Set(["Refunded", "Refunding", "Canceled"]);

function isValid(it) {
  if (!VALID_STATES.has(it.state)) return false;
  const pays = it.payments || [];
  return !(pays.length && pays.every((p) => VOID_PAYMENT_STATES.has(p.state)));
}

const trim = (v) => (v == null ? "" : String(v).trim());

// POST /api/events/:id/attendees/sync — lit les billets de l'événement sur
// HelloAsso, calcule le statut adhérent, met la liste à jour en base (en
// conservant les statuts de relance déjà posés) et renvoie la liste.
// En cas d'erreur HelloAsso, rien n'est effacé.
export async function onRequestPost({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await purgeExpired(env);

  const eventId = params.id;
  const ev = await env.DB.prepare("SELECT id, helloasso_slug FROM events WHERE id = ?").bind(eventId).first();
  if (!ev) return jsonNoStore({ error: "Événement introuvable." }, { status: 404 });
  if (!ev.helloasso_slug) {
    return jsonNoStore({ error: "Ajoute l'identifiant HelloAsso de l'événement pour récupérer les inscrits." }, { status: 400 });
  }
  if (!env.HELLOASSO_CLIENT_ID || !env.HELLOASSO_CLIENT_SECRET || !env.HELLOASSO_ORG_SLUG) {
    return jsonNoStore({ error: "Intégration HelloAsso non configurée." }, { status: 503 });
  }

  let items;
  let memberEmails;
  try {
    const token = await getAccessToken(env);
    items = await fetchFormItems(env, token, env.HELLOASSO_FORM_TYPE || "Event", ev.helloasso_slug, { withDetails: true });
    memberEmails = await fetchMemberEmails(env, token);
  } catch (err) {
    // Statut HTTP seulement : aucune donnée personnelle dans les logs.
    console.error("HelloAsso inscrits:", err && err.message);
    return jsonNoStore(
      { error: "HelloAsso ne répond pas pour le moment. La liste déjà enregistrée est conservée : réessaie dans quelques minutes." },
      { status: 502 }
    );
  }

  const valid = items.filter(isValid);
  // Une ligne par billet : on ne garde que les articles « Registration ». Les
  // dons sont seulement comptés, pour l'expliquer à l'écran.
  const tickets = valid.filter((it) => it.type === "Registration");
  const donations = valid.filter((it) => it.type === "Donation").length;
  // Pré-cochage « absent » : seulement si l'événement a été scanné à l'entrée
  // (au moins un billet scanné). Sinon tout le monde est considéré venu.
  const anyScanned = tickets.some((it) => it.isScanned === true);

  const memberNames = await loadMemberNames(env);
  const optouts = await loadOptouts(env);
  const existingRows = await env.DB.prepare("SELECT * FROM event_attendees WHERE event_id = ?").bind(eventId).all();
  const existing = new Map(existingRows.results.map((r) => [String(r.helloasso_item_id), r]));

  const now = Date.now();
  const writes = [];
  const seen = new Set();
  let seq = 0;

  for (const it of tickets) {
    const haId = String(it.id);
    if (!haId || seen.has(haId)) continue;
    seen.add(haId);

    const u = it.user || {};
    const p = it.payer || {};
    const hasUser = Boolean(trim(u.firstName) || trim(u.lastName));
    const firstName = trim(hasUser ? u.firstName : p.firstName);
    const lastName = trim(hasUser ? u.lastName : p.lastName);

    // Email : 1) question « Email du participant » ; 2) payeur s'il est le
    // participant ; 3) payeur, signalé « via Prénom Nom ».
    let email = null;
    let emailSource = null;
    let payerName = null;
    const cf = (it.customFields || []).find((f) => isParticipantEmailField(f) && EMAIL_RE.test(trim(f.answer)));
    if (cf) {
      email = trim(cf.answer);
      emailSource = "participant";
    } else if (trim(p.email)) {
      email = trim(p.email);
      const samePerson = !hasUser || normalizePersonName(u.firstName, u.lastName) === normalizePersonName(p.firstName, p.lastName);
      emailSource = samePerson ? "payeur" : "payeur_tiers";
      payerName = samePerson ? null : `${trim(p.firstName)} ${trim(p.lastName)}`.trim() || null;
    }

    // Adhérent de la saison en cours : par email (seulement si c'est celui du
    // participant), sinon par prénom + nom normalisés.
    let isMember = 0;
    let memberMatch = null;
    const nameKey = normalizePersonName(firstName, lastName);
    if (email && emailSource !== "payeur_tiers" && memberEmails && memberEmails.has(normalizeEmail(email))) {
      isMember = 1;
      memberMatch = "email";
    } else if (nameKey && memberNames.has(nameKey)) {
      isMember = 1;
      memberMatch = "nom";
    }

    const ex = existing.get(haId);
    const optedOut = email ? optouts.has(await emailHash(email)) : false;
    let status = null;
    if (!isMember) status = optedOut ? "ne_plus_contacter" : (ex && ex.follow_up_status) || "a_relancer";
    const followedUpAt = ex ? ex.followed_up_at ?? null : null;
    // La case « absent » suit les scans tant qu'elle n'a pas été modifiée à la main.
    const absent = ex && ex.absent_manual ? Number(ex.absent) : anyScanned && it.isScanned !== true ? 1 : 0;

    const f = { firstName, lastName, email, emailSource, payerName, isMember, memberMatch, status, followedUpAt, absent };
    if (!ex) {
      const id = `att_${now.toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      writes.push(
        env.DB.prepare(
          `INSERT INTO event_attendees (id, event_id, helloasso_item_id, first_name, last_name, email, email_source, payer_name,
             is_member, member_match, follow_up_status, followed_up_at, absent, absent_manual, retrieved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        ).bind(id, eventId, haId, firstName, lastName, email, emailSource, payerName, isMember, memberMatch, status, followedUpAt, absent, now)
      );
    } else if (changed(ex, f)) {
      // Écriture uniquement si la ligne change (quotas D1).
      writes.push(
        env.DB.prepare(
          `UPDATE event_attendees SET first_name=?, last_name=?, email=?, email_source=?, payer_name=?, is_member=?, member_match=?,
             follow_up_status=?, followed_up_at=?, absent=?, retrieved_at=? WHERE id=?`
        ).bind(firstName, lastName, email, emailSource, payerName, isMember, memberMatch, status, followedUpAt, absent, now, ex.id)
      );
    }
  }

  // Billets annulés ou remboursés depuis la dernière récupération : retirés.
  for (const [haId, ex] of existing) {
    if (!seen.has(haId)) writes.push(env.DB.prepare("DELETE FROM event_attendees WHERE id = ?").bind(ex.id));
  }

  writes.push(
    env.DB.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(lastSyncKey(eventId), JSON.stringify({ at: new Date(now).toISOString(), donations }))
  );
  await env.DB.batch(writes);

  return jsonNoStore(
    await loadList(env, eventId, {
      warning: memberEmails ? null : "Rapprochement par email indisponible (formulaire d'adhésion de la saison en cours introuvable) : seul le nom a servi.",
    })
  );
}

function changed(ex, f) {
  return (
    (ex.first_name || "") !== f.firstName ||
    (ex.last_name || "") !== f.lastName ||
    (ex.email ?? null) !== f.email ||
    (ex.email_source ?? null) !== f.emailSource ||
    (ex.payer_name ?? null) !== f.payerName ||
    Number(ex.is_member) !== f.isMember ||
    (ex.member_match ?? null) !== f.memberMatch ||
    (ex.follow_up_status ?? null) !== f.status ||
    (ex.followed_up_at ?? null) !== f.followedUpAt ||
    Number(ex.absent) !== f.absent
  );
}
