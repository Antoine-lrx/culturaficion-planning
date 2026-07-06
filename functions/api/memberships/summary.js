import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";

// GET /api/memberships/summary — totaux tendido/practicos pour chaque saison
// présente en base, pour l'historique comparatif de la page Adhésions.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const rows = await env.DB.prepare(
    `SELECT season_key,
            SUM(CASE WHEN type = 'tendido' THEN 1 ELSE 0 END) AS tendido,
            SUM(CASE WHEN type = 'practicos' THEN 1 ELSE 0 END) AS practicos
     FROM memberships
     GROUP BY season_key
     ORDER BY season_key ASC`
  ).all();

  return json(
    rows.results.map((r) => ({
      season: r.season_key,
      tendido: r.tendido || 0,
      practicos: r.practicos || 0,
    }))
  );
}
