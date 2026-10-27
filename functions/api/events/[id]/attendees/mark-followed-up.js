import { isAuthorized, unauthorized } from "../../../../_lib/auth.js";
import { normalizeEmail } from "../../../../_lib/people.js";
import { jsonNoStore, purgeExpired, loadList, isToFollowUp } from "../../../../_lib/attendees.js";

// POST /api/events/:id/attendees/mark-followed-up — corps { emails: [...] } :
// passe en « relancé » (avec la date) les lignes à relancer de l'événement
// dont l'email figure dans la liste qui vient d'être copiée.
export async function onRequestPost({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await purgeExpired(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "JSON invalide" }, { status: 400 });
  }
  const emails = new Set((Array.isArray(body?.emails) ? body.emails : []).map(normalizeEmail).filter(Boolean));
  if (!emails.size) return jsonNoStore({ error: "Aucune adresse à marquer." }, { status: 400 });

  const rows = (await env.DB.prepare("SELECT * FROM event_attendees WHERE event_id = ?").bind(params.id).all()).results;
  const now = Date.now();
  const writes = rows
    .filter((r) => isToFollowUp(r) && r.email && emails.has(normalizeEmail(r.email)))
    .map((r) =>
      env.DB.prepare("UPDATE event_attendees SET follow_up_status = 'relance', followed_up_at = ? WHERE id = ?").bind(now, r.id)
    );
  if (writes.length) await env.DB.batch(writes);

  return jsonNoStore(await loadList(env, params.id, { marked: writes.length }));
}
