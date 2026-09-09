import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";

// GET /api/memberships/monthly — données du graphique d'évolution mois par
// mois, saison par saison. Pour chaque saison présente en base :
//   monthly.tendido / monthly.practicos : 12 compteurs de NOUVELLES adhésions
//     par mois, indexés de septembre (0) à août (11).
//   noDate.tendido / noDate.practicos   : adhérents de la saison SANS date
//     d'adhésion, non représentables sur le graphique (affichés honnêtement).
// Le frontend cumule les compteurs et choisit les saisons à superposer. Les
// pierres tombales RGPD (is_deleted = 1) sont exclues.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const rows = await env.DB.prepare(
    "SELECT season_key, type, joined_date FROM memberships WHERE is_deleted = 0"
  ).all();

  // Index de mois dans la saison : septembre = 0 … août = 11.
  const seasonMonthIndex = (m) => (m >= 9 ? m - 9 : m + 3);

  const seasons = new Map();
  const ensure = (season) => {
    if (!seasons.has(season)) {
      seasons.set(season, {
        season,
        monthly: { tendido: Array(12).fill(0), practicos: Array(12).fill(0) },
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
    const month = Number(String(r.joined_date).slice(5, 7));
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      bucket.noDate[r.type] += 1;
      continue;
    }
    bucket.monthly[r.type][seasonMonthIndex(month)] += 1;
  }

  const out = [...seasons.values()].sort((a, b) => a.season.localeCompare(b.season));
  return json({ seasons: out });
}
