import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToCategory } from "../../_lib/serialize.js";

// POST /api/categories — crée une nouvelle catégorie (ajoutée en fin de liste).
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const { id, label, color } = body || {};
  if (!id || !label || !color) {
    return json({ error: "Champs requis manquants (id, label, color)." }, { status: 400 });
  }

  const posRow = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) AS maxPos FROM categories").first();
  const position = (posRow?.maxPos ?? -1) + 1;

  await env.DB.prepare("INSERT INTO categories (id, label, color, position) VALUES (?, ?, ?, ?)")
    .bind(id, label, color, position)
    .run();

  const row = await env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first();
  return json(rowToCategory(row), { status: 201 });
}
