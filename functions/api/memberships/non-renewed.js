import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { currentSeasonKey } from "../../_lib/season.js";

const TYPES = ["tendido", "practicos"];

// Rapprochement par prénom + nom (insensible à la casse, espaces superflus
// ignorés) : la table memberships n'a pas d'identifiant unique par personne.
function normalizeName(firstName, lastName) {
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, " ");
}

// GET /api/memberships/non-renewed — pour chaque type, les adhérents ayant eu
// ce type une saison passée mais aucune adhésion (tout type confondu) pour
// la saison en cours (calculée automatiquement à partir de la date du jour).
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const currentSeason = currentSeasonKey();

  const rows = await env.DB.prepare("SELECT first_name, last_name, type, season_key FROM memberships").all();

  const renewedThisSeason = new Set();
  for (const r of rows.results) {
    if (r.season_key === currentSeason) renewedThisSeason.add(normalizeName(r.first_name, r.last_name));
  }

  const lastByType = { tendido: new Map(), practicos: new Map() };
  for (const r of rows.results) {
    if (!TYPES.includes(r.type) || r.season_key >= currentSeason) continue;
    const key = normalizeName(r.first_name, r.last_name);
    const existing = lastByType[r.type].get(key);
    if (!existing || r.season_key > existing.last_season) {
      lastByType[r.type].set(key, { first_name: r.first_name, last_name: r.last_name, last_season: r.season_key });
    }
  }

  const result = { currentSeason };
  for (const type of TYPES) {
    result[type] = [...lastByType[type].values()]
      .filter((m) => !renewedThisSeason.has(normalizeName(m.first_name, m.last_name)))
      .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
  }

  return json(result);
}
