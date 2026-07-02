import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToCategory } from "../../_lib/serialize.js";

// PUT /api/categories/:id — renomme ou recolore une catégorie.
export async function onRequestPut({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const id = params.id;
  const existing = await env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Catégorie introuvable." }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const label = body.label !== undefined ? body.label : existing.label;
  const color = body.color !== undefined ? body.color : existing.color;

  await env.DB.prepare("UPDATE categories SET label = ?, color = ? WHERE id = ?").bind(label, color, id).run();

  const row = await env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first();
  return json(rowToCategory(row));
}

// DELETE /api/categories/:id — refusé si la catégorie est utilisée par un
// événement ou s'il ne reste qu'une seule catégorie (même règle que côté UI).
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const id = params.id;
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM categories").first();
  if ((countRow?.n ?? 0) <= 1) {
    return json({ error: "Au moins une catégorie est requise." }, { status: 400 });
  }

  const usedRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE type = ?").bind(id).first();
  if ((usedRow?.n ?? 0) > 0) {
    return json({ error: "Catégorie utilisée par des événements — videz-la d'abord." }, { status: 400 });
  }

  await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
