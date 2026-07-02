import { json } from "../_lib/http.js";
import { isAuthorized, unauthorized } from "../_lib/auth.js";
import { rowToEvent, rowToCategory } from "../_lib/serialize.js";

// GET /api/state — renvoie tout ce dont le frontend a besoin en un
// aller-retour : événements, catégories et réglages de saison.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const db = env.DB;
  const [eventsRes, catsRes, metaRes] = await Promise.all([
    db.prepare("SELECT * FROM events ORDER BY created_at ASC").all(),
    db.prepare("SELECT * FROM categories ORDER BY position ASC").all(),
    db.prepare("SELECT * FROM meta").all(),
  ]);

  const metaMap = {};
  for (const row of metaRes.results) metaMap[row.key] = row.value;

  return json({
    events: eventsRes.results.map(rowToEvent),
    categories: catsRes.results.map(rowToCategory),
    meta: {
      startYear: metaMap.startYear != null ? Number(metaMap.startYear) : 2026,
      startMonth: metaMap.startMonth != null ? Number(metaMap.startMonth) : 0,
    },
  });
}
