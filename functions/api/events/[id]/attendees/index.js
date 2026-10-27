import { isAuthorized, unauthorized } from "../../../../_lib/auth.js";
import { jsonNoStore, purgeExpired, loadList, lastSyncKey } from "../../../../_lib/attendees.js";

// GET /api/events/:id/attendees — liste enregistrée et compteurs (inscrits,
// adhérents, non-adhérents, à relancer). N'appelle pas HelloAsso.
export async function onRequestGet({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await purgeExpired(env);
  const ev = await env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(params.id).first();
  if (!ev) return jsonNoStore({ error: "Événement introuvable." }, { status: 404 });
  return jsonNoStore(await loadList(env, params.id));
}

// DELETE /api/events/:id/attendees — supprime toute la liste de l'événement.
// La liste d'opposition (empreintes) est conservée.
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await purgeExpired(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM event_attendees WHERE event_id = ?").bind(params.id),
    env.DB.prepare("DELETE FROM meta WHERE key = ?").bind(lastSyncKey(params.id)),
  ]);
  return jsonNoStore(await loadList(env, params.id));
}
