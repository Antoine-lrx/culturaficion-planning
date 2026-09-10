import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { getAccessToken, centsToEuros, HELLOASSO_API_BASE as API_BASE } from "../../_lib/helloasso.js";
import { seasonFromSlug, isValidSeasonKey } from "../../_lib/season.js";

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
// Préfixe de la clé meta stockant l'agrégat des dons par saison (aucune donnée
// personnelle) : « helloasso_membership_donations:2026-2027 » -> {count,total}.
const DONATIONS_META_PREFIX = "helloasso_membership_donations:";
// Message unique quand la saison du formulaire ne peut pas être déterminée.
const SEASON_ERROR =
  "Impossible de déterminer la saison du formulaire HelloAsso. Vérifie le nom du formulaire dans les réglages Cloudflare.";
const PAGE_SIZE = 100;
// Garde-fou : une invocation Pages Function ne peut faire qu'un nombre limité
// de sous-requêtes réseau. On plafonne le nombre de pages par précaution.
const MAX_PAGES = 50;
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

// Saison du FORMULAIRE HelloAsso (jamais la date de paiement). Une adhésion
// issue de « temporada-2026-2027 » appartient à la saison 2026-2027, qu'elle
// ait été réglée le 31 août ou le 15 octobre. Ordre de détermination :
//   1. la saison lue dans le slug du formulaire (un seul motif AAAA-AAAA) ;
//   2. sinon la variable d'environnement HELLOASSO_MEMBERSHIP_SEASON ;
//   3. si les deux se contredisent, ou si aucune n'est valide → erreur (la
//      synchronisation n'écrit alors rien).
function resolveFormSeason(env) {
  const fromSlug = seasonFromSlug(env.HELLOASSO_MEMBERSHIP_FORM_SLUG);
  const rawEnv = env.HELLOASSO_MEMBERSHIP_SEASON;
  const fromEnv = isValidSeasonKey(rawEnv) ? String(rawEnv).trim() : null;
  if (fromSlug && fromEnv && fromSlug !== fromEnv) return { error: SEASON_ERROR };
  const season = fromSlug || fromEnv;
  if (!season) return { error: SEASON_ERROR };
  return { season };
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

  // Saison du formulaire (point 1). Résolue AVANT tout appel réseau : si elle
  // est indéterminée, on n'écrit rien et on renvoie un message clair.
  const seasonResolution = resolveFormSeason(env);
  if (seasonResolution.error) {
    return json({ error: seasonResolution.error, lastSync }, { status: 200 });
  }
  const formSeason = seasonResolution.season;

  try {
    const token = await getAccessToken(env);

    // Synchro complète du formulaire à chaque fois (pas de fenêtre
    // incrémentale). Deux raisons : (1) l'agrégat des dons de la saison ne se
    // stockant que globalement, il doit être RECOMPTÉ intégralement à chaque
    // synchro ; (2) un formulaire de saison (« temporada-2026-2027 ») ne
    // contient qu'une saison, l'ensemble est donc borné. Le garde-fou de 60
    // minutes et l'écriture uniquement-si-changement protègent les quotas D1.
    const fromISO = null;

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
    // Clé = `${type}|${libellé}` pour distinguer, à l'affichage, un libellé
    // vide selon le type d'article. Valeur = { tierName, type, count }.
    const unknownTiers = new Map();
    const seen = new Set();
    let created = 0;
    let updated = 0;
    let removed = 0;
    let newIdSeq = 0;
    // Agrégat des dons de la saison (point 2) — aucune donnée personnelle.
    let donationCount = 0;
    let donationTotal = 0;

    for (const item of activeItems) {
      const haId = String(item.id);
      if (!haId || seen.has(haId)) continue;
      seen.add(haId);

      const itemType = item.type != null ? String(item.type) : "";
      // Montant : conversion centimes → euros à un seul endroit (util partagé).
      const amount = centsToEuros(item.amount);

      // Dons (type Donation) : jamais des adhésions. Ils ne sont ni écrits dans
      // `memberships`, ni comptés dans les totaux/graphique/relances/7562. On
      // n'en garde qu'un agrégat par saison (voir plus bas).
      if (itemType === "Donation") {
        donationCount += 1;
        donationTotal += amount;
        continue;
      }

      // Correspondance stricte du tarif. On tente la table de correspondance
      // pour les articles de type Membership (ou de type absent : le formulaire
      // est un formulaire d'adhésion — repli défensif rétrocompatible).
      const tierName = item.name != null ? String(item.name) : "";
      const isMembershipType = itemType === "" || itemType === "Membership";
      const mapped = isMembershipType ? TIER_MAPPING[normalizeTier(tierName)] : undefined;
      if (!mapped) {
        // Type inconnu, ou Membership au libellé non reconnu : jamais importé
        // en silence, jamais deviné. On conserve le type pour l'affichage.
        const key = `${itemType}|${tierName}`;
        const cur = unknownTiers.get(key) || { tierName, type: itemType, count: 0 };
        cur.count += 1;
        unknownTiers.set(key, cur);
        continue;
      }

      // Adhérent (user) ; repli sur le payeur seulement si le champ est vide.
      // Champ par champ : on ne mélange pas deux personnes plus que nécessaire.
      const u = item.user || {};
      const p = item.payer || {};
      const firstName = String(u.firstName || p.firstName || "").trim();
      const lastName = String(u.lastName || p.lastName || "").trim();

      // Date de la commande, tronquée à la date seule (AAAA-MM-JJ ISO).
      // Primaire : order.date ; replis défensifs selon la forme exacte de la
      // réponse HelloAsso, pour ne jamais perdre la date d'adhésion.
      const rawDate = (item.order && item.order.date) || item.orderDate || item.date || null;
      let joinedDate = null;
      if (rawDate) {
        const d = new Date(rawDate);
        if (!Number.isNaN(d.getTime())) joinedDate = d.toISOString().slice(0, 10);
      }
      // Point 1 : la saison est celle du formulaire, jamais la date de paiement.
      // La joined_date reste la vraie date de paiement (on ne la modifie pas).
      const seasonKey = formSeason;

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

    // Reprise des données existantes (point 1) : la synchro étant complète, TOUTE
    // ligne du formulaire courant est re-parcourue ci-dessus et sa season_key
    // recalée sur formSeason par le chemin ligne-par-ligne dès qu'elle diffère
    // (via membershipChanged), et uniquement si elle change (quotas D1). On
    // évite volontairement un UPDATE global `WHERE source='helloasso'` : le jour
    // où le slug du formulaire changera de saison, il réaffecterait à tort les
    // adhésions HelloAsso des saisons passées. Les pierres tombales (is_deleted
    // = 1) ne sont jamais touchées : elles restent en pierre tombale.

    // Agrégat des dons de la saison (point 2). Écriture uniquement si la valeur
    // change. Aucune donnée personnelle : uniquement un nombre et un total.
    const donationsKey = `${DONATIONS_META_PREFIX}${formSeason}`;
    const donationsValue = JSON.stringify({
      count: donationCount,
      total: Math.round(donationTotal * 100) / 100,
    });
    const prevDonations = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(donationsKey).first();
    let prevDonationsValue = null;
    if (prevDonations?.value) {
      try {
        const p = JSON.parse(prevDonations.value);
        prevDonationsValue = JSON.stringify({ count: Number(p.count) || 0, total: Number(p.total) || 0 });
      } catch {
        /* valeur illisible : on la réécrira */
      }
    }
    // On ne crée pas de clé vide : si aucun don et rien en base, on n'écrit rien.
    if (donationsValue !== prevDonationsValue && !(donationCount === 0 && prevDonationsValue === null)) {
      writes.push(
        env.DB.prepare(
          "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).bind(donationsKey, donationsValue)
      );
    }

    const nowISO = new Date().toISOString();
    writes.push(
      env.DB.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind(META_KEY, nowISO)
    );

    // Une seule opération D1 groupée (les quotas d'écritures sont désormais
    // appliqués strictement). Une synchro où rien n'a bougé n'écrit que la
    // clé de date de synchro (et éventuellement le recalage season_key à 0 ligne).
    await env.DB.batch(writes);

    return json({
      created,
      updated,
      removed,
      unknownTiers: [...unknownTiers.values()].map((u) => ({ tierName: u.tierName, type: u.type, count: u.count })),
      donations: { count: donationCount, total: Math.round(donationTotal * 100) / 100 },
      season: formSeason,
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
