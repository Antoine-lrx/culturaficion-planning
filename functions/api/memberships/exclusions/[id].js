import { json } from "../../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../../_lib/auth.js";

// DELETE /api/memberships/exclusions/:id — réintègre la personne dans sa
// liste (annule un retrait manuel). Suppression réelle de la ligne.
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  const id = String(params.id || "");
  if (!/^ex_[a-z0-9_]{1,40}$/.test(id)) return json({ error: "Retrait introuvable." }, { status: 404 });
  const res = await env.DB.prepare("DELETE FROM membership_exclusions WHERE id = ?").bind(id).run();
  if (!res.meta || !res.meta.changes) return json({ error: "Retrait introuvable." }, { status: 404 });
  return new Response(null, { status: 204 });
}
