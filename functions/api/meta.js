import { json } from "../_lib/http.js";
import { isAuthorized, unauthorized } from "../_lib/auth.js";

// PUT /api/meta — met à jour le mois/année de départ de la saison.
export async function onRequestPut({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const { startYear, startMonth } = body || {};
  const db = env.DB;
  const stmts = [];
  if (startYear !== undefined) {
    stmts.push(
      db.prepare(
        "INSERT INTO meta (key, value) VALUES ('startYear', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind(String(startYear))
    );
  }
  if (startMonth !== undefined) {
    stmts.push(
      db.prepare(
        "INSERT INTO meta (key, value) VALUES ('startMonth', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind(String(startMonth))
    );
  }
  if (stmts.length) await db.batch(stmts);

  return json({ ok: true, startYear, startMonth });
}
