import { json } from "../../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../../_lib/auth.js";
import { currentSeasonKey } from "../../../_lib/season.js";
import {
  LIST_KEYS, REASONS, PERMANENT_REASONS, isPersonKey, loadActiveExclusions, rowToExclusion,
} from "../../../_lib/exclusions.js";

const noStore = { headers: { "cache-control": "no-store" } };

// GET /api/memberships/exclusions?list=perdus_de_vue|venus_sans_adherer
// Retraits manuels actifs d'une liste (permanents ou de la saison en cours).
// Ne renvoie aucun nom : les noms sont rattachés par les endpoints des listes.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();
  const list = new URL(request.url).searchParams.get("list");
  if (!LIST_KEYS.includes(list)) return json({ error: "Liste inconnue." }, { status: 400 });
  const rows = await loadActiveExclusions(env, list);
  return json({ list, currentSeason: currentSeasonKey(), exclusions: rows.map(rowToExclusion) }, noStore);
}

// POST /api/memberships/exclusions  { list, personKey, reason }
// Retire une personne d'une liste. « Ne plus afficher » est permanent ; les
// autres motifs valent pour la saison en cours seulement. Un seul appel D1
// (batch) : nettoyage des retraits des saisons passées, remplacement d'un
// éventuel retrait existant pour la même personne, puis insertion.
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }
  const { list, personKey, reason } = body || {};
  if (!LIST_KEYS.includes(list)) return json({ error: "Liste inconnue." }, { status: 400 });
  if (!isPersonKey(personKey)) return json({ error: "Personne invalide." }, { status: 400 });
  if (!REASONS.includes(reason)) return json({ error: "Motif invalide." }, { status: 400 });

  const season = currentSeasonKey();
  const seasonKey = PERMANENT_REASONS.has(reason) ? null : season;
  const id = `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = Date.now();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM membership_exclusions WHERE season_key IS NOT NULL AND season_key <> ?1").bind(season),
    env.DB.prepare("DELETE FROM membership_exclusions WHERE list_key = ?1 AND person_key = ?2").bind(list, personKey),
    env.DB.prepare(
      `INSERT INTO membership_exclusions (id, list_key, person_key, season_key, reason, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(id, list, personKey, seasonKey, reason, createdAt),
  ]);

  return json(
    rowToExclusion({ id, list_key: list, person_key: personKey, season_key: seasonKey, reason, created_at: createdAt }),
    { status: 201, ...noStore }
  );
}
