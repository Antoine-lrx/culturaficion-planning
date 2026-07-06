import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToMembership } from "../../_lib/serialize.js";

const TYPES = ["tendido", "practicos"];

// PUT /api/memberships/:id — modifie un adhérent.
export async function onRequestPut({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const id = params.id;
  const existing = await env.DB.prepare("SELECT * FROM memberships WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Adhérent introuvable." }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  if (body.type !== undefined && !TYPES.includes(body.type)) {
    return json({ error: "Type d'adhésion invalide (tendido ou practicos)." }, { status: 400 });
  }

  const merged = {
    firstName: body.firstName !== undefined ? String(body.firstName).trim() : existing.first_name,
    lastName: body.lastName !== undefined ? String(body.lastName).trim() : existing.last_name,
    type: body.type ?? existing.type,
    seasonKey: body.seasonKey ?? existing.season_key,
    joinedDate: body.joinedDate !== undefined ? body.joinedDate : existing.joined_date,
  };

  await env.DB.prepare(
    `UPDATE memberships SET first_name=?, last_name=?, type=?, season_key=?, joined_date=? WHERE id=?`
  ).bind(merged.firstName, merged.lastName, merged.type, merged.seasonKey, merged.joinedDate, id).run();

  const row = await env.DB.prepare("SELECT * FROM memberships WHERE id = ?").bind(id).first();
  return json(rowToMembership(row));
}

// DELETE /api/memberships/:id — suppression sans étape supplémentaire (RGPD).
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await env.DB.prepare("DELETE FROM memberships WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
