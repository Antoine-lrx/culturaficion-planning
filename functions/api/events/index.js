import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToEvent } from "../../_lib/serialize.js";

// POST /api/events — crée un nouvel événement.
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const { id, type, title, monthKey, date, lieu, status, proposedBy, notes } = body || {};
  if (!id || !type || !title || !monthKey || !status) {
    return json({ error: "Champs requis manquants (id, type, title, monthKey, status)." }, { status: 400 });
  }

  const createdAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO events (id, type, title, month_key, date, lieu, status, proposed_by, voters, notes, registered, revenue, expenses, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, NULL, NULL, NULL, ?)`
  ).bind(id, type, title, monthKey, date || null, lieu || null, status, proposedBy || null, notes || null, createdAt).run();

  const row = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return json(rowToEvent(row), { status: 201 });
}
