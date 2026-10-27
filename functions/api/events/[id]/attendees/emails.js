import { isAuthorized, unauthorized } from "../../../../_lib/auth.js";
import { getAccessToken } from "../../../../_lib/helloasso.js";
import { normalizeEmail } from "../../../../_lib/people.js";
import {
  jsonNoStore, purgeExpired, fetchMemberEmails, loadOptouts, emailHash, isToFollowUp,
} from "../../../../_lib/attendees.js";

// GET /api/events/:id/attendees/emails — adresses distinctes à relancer :
// lignes non adhérentes, non absentes, au statut « à relancer ». Exclut toute
// adresse portée par une ligne adhérente, toute adresse d'un adhérent de la
// saison (lue en direct sur HelloAsso, non stockée) et toute adresse de la
// liste d'opposition.
export async function onRequestGet({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await purgeExpired(env);

  const rows = (await env.DB.prepare("SELECT * FROM event_attendees WHERE event_id = ?").bind(params.id).all()).results;
  const excluded = new Set(rows.filter((r) => r.is_member && r.email).map((r) => normalizeEmail(r.email)));

  let memberEmails = null;
  if (env.HELLOASSO_CLIENT_ID && env.HELLOASSO_CLIENT_SECRET && env.HELLOASSO_ORG_SLUG) {
    try {
      memberEmails = await fetchMemberEmails(env, await getAccessToken(env));
    } catch (err) {
      // Sans cette vérification, on risquerait de relancer un adhérent : on
      // préfère ne rien renvoyer.
      console.error("HelloAsso adhérents (emails):", err && err.message);
      return jsonNoStore(
        { error: "Impossible de vérifier les adhérents sur HelloAsso pour le moment : réessaie dans quelques minutes." },
        { status: 502 }
      );
    }
  }
  if (memberEmails) for (const e of memberEmails) excluded.add(e);

  const optouts = await loadOptouts(env);
  const emails = [];
  const seen = new Set();
  for (const r of rows) {
    if (!isToFollowUp(r) || !r.email) continue;
    const e = normalizeEmail(r.email);
    if (seen.has(e) || excluded.has(e)) continue;
    seen.add(e);
    if (optouts.has(await emailHash(e))) continue;
    emails.push(e);
  }

  return jsonNoStore({
    emails,
    warning: memberEmails ? null : "Emails des adhérents HelloAsso non vérifiés (formulaire d'adhésion de la saison en cours introuvable).",
  });
}
