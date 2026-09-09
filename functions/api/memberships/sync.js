import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { getAccessToken, HELLOASSO_API_BASE as API_BASE } from "../../_lib/helloasso.js";

// ─────────────────────────────────────────────────────────────────────────
// Correspondance entre les libellés de tarifs HelloAsso et les types/tarifs
// de l'application.
// Les clés sont les libellés NORMALISÉS (minuscules, sans accent, espaces
// réduits). Libellés relevés dans le formulaire "temporada-2026-2027".
// À METTRE À JOUR si les libellés changent dans HelloAsso (nouvelle saison,
// nouveau tarif). Un libellé non listé ici part dans « tarif non reconnu »
// et n'est jamais rattaché au hasard.
//
// ⚠️ Correspondance = ÉGALITÉ STRICTE sur le libellé normalisé complet.
// Surtout PAS includes/startsWith/regex : « tendido » est une sous-chaîne de
// « tendido - jeune (-30 ans) », un rapprochement approximatif classerait
// toutes les adhésions jeunes en tarif plein, silencieusement.
const TIER_MAPPING = {
  "tendido":                    { type: "tendido",   tarif: "plein" }, // 45 €
  "practico":                   { type: "practicos", tarif: "plein" }, // 90 €
  "tendido - jeune (-30 ans)":  { type: "tendido",   tarif: "jeune" }, // 30 €
  "practico - jeune (-30 ans)": { type: "practicos", tarif: "jeune" }, // 70 €
};

const META_KEY = "helloasso_memberships_last_sync";
const PAGE_SIZE = 100;
// Garde-fou : une invocation Pages Function ne peut faire qu'un nombre limité
// de sous-requêtes réseau. On plafonne le nombre de pages par précaution.
const MAX_PAGES = 50;
// Marge de rattrapage des changements d'état tardifs (voir §2).
const SYNC_OVERLAP_DAYS = 7;
// Garde-fou anti-gaspillage (quotas D1) : deux synchros rapprochées sans
// `force` ne rappellent pas HelloAsso.
const MIN_INTERVAL_MS = 60 * 60 * 1000;

// Normalisation d'un libellé de tarif avant comparaison stricte. Le libellé
// brut (item.name) reste stocké tel quel dans tier_name.
function normalizeTier(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Saison septembre → août déduite de la date d'adhésion (même convention que
// toute l'application).
function seasonFromJoinedDate(joinedDate) {
  const y = Number(joinedDate.slice(0, 4));
  const m = Number(joinedDate.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

async function readLastSync(env) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(META_KEY).first();
  return row?.value || null;
}

// POST /api/memberships/sync — récupère les adhésions HelloAsso et met la base
// à jour de façon économe. Corps optionnel : { "force": true }.
//
// Réponses (toujours 200 hors 401) :
//   { created, updated, removed, unknownTiers, lastSync }   — synchro réussie
//   { skipped: true, lastSync }                             — garde-fou 60 min
//   { error, lastSync }                                     — HelloAsso indispo
// Le endpoint ne bloque jamais la page : une erreur renvoie un message + la
// dernière date de synchro connue, et la liste reste servie depuis la base.
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    /* corps facultatif */
  }
  const force = body.force === true;

  const lastSync = await readLastSync(env);

  // Garde-fou anti-gaspillage : synchro récente et pas de force → on ne
  // rappelle pas HelloAsso ni n'écrit en base.
  if (!force && lastSync && Date.now() - Date.parse(lastSync) < MIN_INTERVAL_MS) {
    return json({ skipped: true, lastSync });
  }

  if (!env.HELLOASSO_CLIENT_ID || !env.HELLOASSO_CLIENT_SECRET || !env.HELLOASSO_ORG_SLUG || !env.HELLOASSO_MEMBERSHIP_FORM_SLUG) {
    return json({ error: "Intégration HelloAsso (adhésions) non configurée.", lastSync }, { status: 200 });
  }

  try {
    const token = await getAccessToken(env);

    // Première synchro (aucun lastSync) : on récupère tout l'historique du
    // formulaire. Sinon on repart de la dernière synchro moins 7 jours.
    let fromISO = null;
    if (lastSync) {
      const from = new Date(Date.parse(lastSync) - SYNC_OVERLAP_DAYS * 24 * 60 * 60 * 1000);
      fromISO = from.toISOString();
    }

    // itemStates=Registered est indispensable : adhésions enregistrées à la
    // main par l'association (chèque, espèces). Processed = paiement en ligne.
    const activeItems = await fetchItems(env, token, ["Processed", "Registered"], fromISO);
    // Canceled dans un second temps : détecter les annulations.
    const canceledItems = await fetchItems(env, token, ["Canceled"], fromISO);

    // État actuel des lignes HelloAsso en base (source de vérité pour les
    // écritures économes et les pierres tombales RGPD).
    const existingRows = await env.DB.prepare(
      "SELECT id, helloasso_item_id, first_name, last_name, type, tarif, amount, tier_name, season_key, joined_date, is_deleted FROM memberships WHERE source = 'helloasso'"
    ).all();
    const existingMap = new Map();
    for (const r of existingRows.results) existingMap.set(String(r.helloasso_item_id), r);

    const writes = [];
    const unknownTiers = new Map();
    const seen = new Set();
    let created = 0;
    let updated = 0;
    let removed = 0;
    let newIdSeq = 0;

    for (const item of activeItems) {
      const haId = String(item.id);
      if (!haId || seen.has(haId)) continue;
      seen.add(haId);

      // Correspondance stricte du tarif.
      const tierName = item.name != null ? String(item.name) : "";
      const mapped = TIER_MAPPING[normalizeTier(tierName)];
      if (!mapped) {
        // Tarif non reconnu : jamais importé en silence, jamais deviné.
        unknownTiers.set(tierName, (unknownTiers.get(tierName) || 0) + 1);
        continue;
      }

      // Adhérent (user) ; repli sur le payeur seulement si le champ est vide.
      // Champ par champ : on ne mélange pas deux personnes plus que nécessaire.
      const u = item.user || {};
      const p = item.payer || {};
      const firstName = String(u.firstName || p.firstName || "").trim();
      const lastName = String(u.lastName || p.lastName || "").trim();

      // Montant : les montants HelloAsso sont en CENTIMES → division par 100.
      const amount = (Number(item.amount) || 0) / 100;

      // Date de la commande, tronquée à la date seule (AAAA-MM-JJ ISO).
      // Primaire : order.date ; replis défensifs selon la forme exacte de la
      // réponse HelloAsso, pour ne jamais perdre la date d'adhésion.
      const rawDate = (item.order && item.order.date) || item.orderDate || item.date || null;
      let joinedDate = null;
      if (rawDate) {
        const d = new Date(rawDate);
        if (!Number.isNaN(d.getTime())) joinedDate = d.toISOString().slice(0, 10);
      }
      const seasonKey = joinedDate ? seasonFromJoinedDate(joinedDate) : null;

      const ex = existingMap.get(haId);

      // Pierre tombale RGPD : ligne supprimée → on ne recrée jamais.
      if (ex && ex.is_deleted) continue;

      const fields = { firstName, lastName, type: mapped.type, tarif: mapped.tarif, amount, tierName, seasonKey, joinedDate };

      if (!ex) {
        const id = `ha_${Date.now().toString(36)}_${(newIdSeq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        writes.push(
          env.DB.prepare(
            `INSERT INTO memberships (id, first_name, last_name, type, tarif, amount, source, helloasso_item_id, tier_name, season_key, joined_date, is_deleted, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'helloasso', ?, ?, ?, ?, 0, ?)`
          ).bind(id, firstName, lastName, mapped.type, mapped.tarif, amount, haId, tierName, seasonKey, joinedDate, Date.now())
        );
        created += 1;
      } else if (membershipChanged(ex, fields)) {
        // Écriture uniquement si quelque chose a réellement changé.
        writes.push(
          env.DB.prepare(
            `UPDATE memberships SET first_name=?, last_name=?, type=?, tarif=?, amount=?, tier_name=?, season_key=?, joined_date=? WHERE id=?`
          ).bind(firstName, lastName, mapped.type, mapped.tarif, amount, tierName, seasonKey, joinedDate, ex.id)
        );
        updated += 1;
      }
    }

    // Annulations : une ligne HelloAsso correspondante et non déjà supprimée
    // est retirée de la base. Une pierre tombale RGPD reste intacte.
    for (const item of canceledItems) {
      const haId = String(item.id);
      const ex = existingMap.get(haId);
      if (ex && !ex.is_deleted) {
        writes.push(env.DB.prepare("DELETE FROM memberships WHERE id = ?").bind(ex.id));
        removed += 1;
      }
    }

    const nowISO = new Date().toISOString();
    writes.push(
      env.DB.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind(META_KEY, nowISO)
    );

    // Une seule opération D1 groupée (les quotas d'écritures sont désormais
    // appliqués strictement). Une synchro où rien n'a bougé n'écrit que la
    // clé de date de synchro.
    await env.DB.batch(writes);

    return json({
      created,
      updated,
      removed,
      unknownTiers: [...unknownTiers.entries()].map(([tierName, count]) => ({ tierName, count })),
      lastSync: nowISO,
    });
  } catch (err) {
    // Détail utile dans les logs Cloudflare, jamais renvoyé au frontend, et
    // sans aucune donnée personnelle.
    console.error("HelloAsso adhésions:", err && err.message);
    return json({ error: "Synchronisation HelloAsso indisponible pour le moment.", lastSync }, { status: 200 });
  }
}

// GET /api/memberships/sync — renvoie seulement la date de dernière synchro,
// sans appeler HelloAsso (utile à l'affichage sans consommer de quota).
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();
  return json({ lastSync: await readLastSync(env) });
}

function membershipChanged(ex, f) {
  const exAmount = ex.amount == null ? null : Number(ex.amount);
  return (
    (ex.first_name || "") !== f.firstName ||
    (ex.last_name || "") !== f.lastName ||
    ex.type !== f.type ||
    (ex.tarif ?? null) !== f.tarif ||
    exAmount !== f.amount ||
    (ex.tier_name ?? null) !== f.tierName ||
    (ex.season_key ?? null) !== f.seasonKey ||
    (ex.joined_date ?? null) !== f.joinedDate
  );
}

// Récupère tous les articles d'un ou plusieurs états, en paginant via
// continuationToken. RGPD : seuls les champs autorisés sont lus par
// l'appelant ; email, adresse, téléphone, etc. ne sont jamais extraits.
async function fetchItems(env, token, states, fromISO) {
  const orgSlug = env.HELLOASSO_ORG_SLUG;
  const formSlug = env.HELLOASSO_MEMBERSHIP_FORM_SLUG;
  const out = [];
  let continuationToken = "";
  let page = 0;

  do {
    page += 1;
    const url = new URL(`${API_BASE}/organizations/${orgSlug}/forms/Membership/${formSlug}/items`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    for (const s of states) url.searchParams.append("itemStates", s);
    if (fromISO) url.searchParams.set("from", fromISO);
    if (continuationToken) url.searchParams.set("continuationToken", continuationToken);

    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Appel à ${url.pathname} en échec (statut ${res.status}) : ${bodyText.slice(0, 300)}`);
    }
    const data = await res.json();
    const items = data.data || [];
    out.push(...items);

    // HelloAsso renvoie un continuationToken même sur la dernière page : le
    // signal fiable de fin est une page plus courte que la taille demandée.
    continuationToken =
      items.length === PAGE_SIZE ? (data.pagination && data.pagination.continuationToken) || "" : "";
  } while (continuationToken && page < MAX_PAGES);

  return out;
}
