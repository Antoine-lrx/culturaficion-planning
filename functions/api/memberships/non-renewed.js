import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { currentSeasonKey } from "../../_lib/season.js";

const TYPE_ORDER = ["tendido", "practicos"];

// Rapprochement par prénom + nom. Les noms venant de HelloAsso peuvent être
// orthographiés différemment de ceux saisis à la main (casse, accents,
// espaces) : on normalise donc UNIQUEMENT pour la comparaison — minuscules,
// accents supprimés, espaces réduits, bords rognés. Les valeurs stockées et
// affichées ne sont jamais altérées. Limite assumée et connue : deux
// orthographes réellement différentes (« Jean-Pierre » vs « JP »), ou un
// prénom et un nom inversés, ne sont pas rapprochés.
function normalizeName(firstName, lastName) {
  return `${firstName || ""} ${lastName || ""}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Badges (type + tarif) d'une personne pour une saison donnée, dans l'ordre
// Tendido puis Prácticos. Le tarif n'est renseigné que s'il est connu.
function badgesFrom(typeMap) {
  const out = [];
  for (const t of TYPE_ORDER) {
    if (typeMap.has(t)) out.push({ type: t, tarif: typeMap.get(t) ?? null });
  }
  return out;
}

// GET /api/memberships/non-renewed — deux listes distinctes, par PERSONNE
// (tous types et toutes sources confondus), et non plus par type (point 4).
//   toRelance : présents en N-1, absents en N (adhérents de la saison dernière).
//   perdus    : absents en N et en N-1, mais présents sur une saison antérieure.
// N = saison en cours (date du jour, règle existante). Dès qu'une personne est
// présente en N (au moins une ligne non supprimée), elle sort des deux listes.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const currentSeason = currentSeasonKey();
  const y1 = Number(currentSeason.split("-")[0]);
  const previousSeason = `${y1 - 1}-${y1}`;

  const rows = await env.DB.prepare(
    "SELECT first_name, last_name, type, tarif, season_key FROM memberships WHERE is_deleted = 0"
  ).all();

  // Une entrée par personne : nom affiché + saisons de présence, chaque saison
  // portant les types pris (avec le tarif si connu).
  const byPerson = new Map();
  for (const r of rows.results) {
    if (!TYPE_ORDER.includes(r.type) || !r.season_key) continue;
    const key = normalizeName(r.first_name, r.last_name);
    let person = byPerson.get(key);
    if (!person) {
      person = { first_name: r.first_name, last_name: r.last_name, seasons: new Map() };
      byPerson.set(key, person);
    }
    if (!person.seasons.has(r.season_key)) person.seasons.set(r.season_key, new Map());
    const typeMap = person.seasons.get(r.season_key);
    // On garde un tarif connu de préférence à un tarif inconnu (null).
    if (!typeMap.has(r.type) || (typeMap.get(r.type) == null && r.tarif != null)) {
      typeMap.set(r.type, r.tarif ?? null);
    }
  }

  const toRelance = [];
  const perdus = [];
  for (const person of byPerson.values()) {
    if (person.seasons.has(currentSeason)) continue; // présent en N → hors listes

    if (person.seasons.has(previousSeason)) {
      toRelance.push({
        first_name: person.first_name,
        last_name: person.last_name,
        badges: badgesFrom(person.seasons.get(previousSeason)),
      });
      continue;
    }

    // Absent en N et N-1 : chercher la dernière saison de présence.
    let lastSeason = null;
    for (const s of person.seasons.keys()) {
      if (!lastSeason || s > lastSeason) lastSeason = s;
    }
    if (!lastSeason) continue;
    perdus.push({
      first_name: person.first_name,
      last_name: person.last_name,
      last_season: lastSeason,
      badges: badgesFrom(person.seasons.get(lastSeason)),
    });
  }

  const byName = (a, b) =>
    a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
  toRelance.sort(byName);
  // Perdus de vue : dernière adhésion la plus récente en premier.
  perdus.sort((a, b) => b.last_season.localeCompare(a.last_season) || byName(a, b));

  return json({ currentSeason, previousSeason, toRelance, perdus });
}
