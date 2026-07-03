import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToEvent } from "../../_lib/serialize.js";

// PUT /api/events/:id — met à jour un événement (édition, vote, bilan…).
// Seuls les champs présents dans le corps de la requête sont modifiés.
export async function onRequestPut({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const id = params.id;
  const existing = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Événement introuvable." }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const merged = {
    type: body.type ?? existing.type,
    title: body.title ?? existing.title,
    monthKey: body.monthKey ?? existing.month_key,
    date: body.date !== undefined ? body.date : existing.date,
    lieu: body.lieu !== undefined ? body.lieu : existing.lieu,
    status: body.status ?? existing.status,
    proposedBy: body.proposedBy !== undefined ? body.proposedBy : existing.proposed_by,
    voters: body.voters !== undefined ? JSON.stringify(body.voters) : existing.voters,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    registered: body.registered !== undefined ? body.registered : existing.registered,
    revenue: body.revenue !== undefined ? body.revenue : existing.revenue,
    expenses: body.expenses !== undefined ? body.expenses : existing.expenses,
  };

  await env.DB.prepare(
    `UPDATE events SET type=?, title=?, month_key=?, date=?, lieu=?, status=?, proposed_by=?, voters=?, notes=?, registered=?, revenue=?, expenses=?
     WHERE id=?`
  ).bind(
    merged.type, merged.title, merged.monthKey, merged.date, merged.lieu, merged.status, merged.proposedBy,
    merged.voters, merged.notes, merged.registered, merged.revenue, merged.expenses, id
  ).run();

  const row = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return json(rowToEvent(row));
}

// DELETE /api/events/:id
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
