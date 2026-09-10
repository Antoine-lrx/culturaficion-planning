import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";

// Nombre de semaines d'une saison. Semaines de 7 jours comptées à partir du
// 1er septembre (et NON les semaines calendaires ISO), pour que la semaine 3
// d'une saison soit comparable à la semaine 3 d'une autre. Semaine 1 = 1er au
// 7 septembre ; les un ou deux derniers jours d'août tombent en semaine 52.
const WEEKS = 52;
const DAY_MS = 24 * 60 * 60 * 1000;

// Index de semaine (0..51) d'une date d'adhésion dans sa saison.
//  - avant le 1er septembre (adhésion réglée en amont) → semaine 1 (index 0) ;
//  - au-delà de la 52e semaine (fin août) → semaine 52 (index 51).
function weekIndex(joinedDate, seasonStartYear) {
  const start = Date.UTC(seasonStartYear, 8, 1); // 1er septembre, 8 = septembre
  const t = Date.parse(`${joinedDate}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  let wk = Math.floor((t - start) / (7 * DAY_MS));
  if (wk < 0) wk = 0;
  if (wk > WEEKS - 1) wk = WEEKS - 1;
  return wk;
}

// GET /api/memberships/weekly — données du graphique d'évolution SEMAINE par
// semaine, saison par saison. Pour chaque saison présente en base :
//   weekly.tendido / weekly.practicos : 52 compteurs de NOUVELLES adhésions.
//   beforeSept.tendido / .practicos   : adhésions de la saison réglées avant le
//     1er septembre (déjà comptées en semaine 1) — pour la mention honnête.
//   noDate.tendido / .practicos       : adhésions sans date, non représentables.
// Le frontend cumule les compteurs et choisit les saisons à superposer. Les
// pierres tombales RGPD (is_deleted = 1) sont exclues.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const rows = await env.DB.prepare(
    "SELECT season_key, type, joined_date FROM memberships WHERE is_deleted = 0"
  ).all();

  const seasons = new Map();
  const ensure = (season) => {
    if (!seasons.has(season)) {
      seasons.set(season, {
        season,
        weekly: { tendido: Array(WEEKS).fill(0), practicos: Array(WEEKS).fill(0) },
        beforeSept: { tendido: 0, practicos: 0 },
        noDate: { tendido: 0, practicos: 0 },
      });
    }
    return seasons.get(season);
  };

  for (const r of rows.results) {
    if (r.type !== "tendido" && r.type !== "practicos") continue;
    if (!r.season_key) continue;
    const bucket = ensure(r.season_key);
    if (!r.joined_date) {
      bucket.noDate[r.type] += 1;
      continue;
    }
    const startYear = Number(String(r.season_key).split("-")[0]);
    const wk = weekIndex(String(r.joined_date), startYear);
    if (wk == null) {
      bucket.noDate[r.type] += 1;
      continue;
    }
    bucket.weekly[r.type][wk] += 1;
    // Réglée avant le 1er septembre : comptée en semaine 1, signalée à part.
    if (String(r.joined_date) < `${startYear}-09-01`) bucket.beforeSept[r.type] += 1;
  }

  const out = [...seasons.values()].sort((a, b) => a.season.localeCompare(b.season));
  return json({ weeks: WEEKS, seasons: out });
}
