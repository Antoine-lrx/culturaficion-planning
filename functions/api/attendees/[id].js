import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { normalizeEmail } from "../../_lib/people.js";
import { jsonNoStore, purgeExpired, loadList, emailHash } from "../../_lib/attendees.js";

const STATUSES = ["a_relancer", "relance", "ne_plus_contacter"];

// PUT /api/attendees/:id — corps { followUpStatus?, absent? }.
// « Ne plus contacter » ajoute l'empreinte de l'adresse à la liste
// d'opposition et s'applique à toutes les lignes portant cette adresse, sur
// tous les événements. Revenir sur ce choix retire l'empreinte.
// Renvoie la liste à jour de l'événement de la ligne.
export async function onRequestPut({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await purgeExpired(env);

  const row = await env.DB.prepare("SELECT * FROM event_attendees WHERE id = ?").bind(params.id).first();
  if (!row) return jsonNoStore({ error: "Inscrit introuvable." }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "JSON invalide" }, { status: 400 });
  }

  const writes = [];
  const now = Date.now();

  if (body.absent !== undefined) {
    writes.push(
      env.DB.prepare("UPDATE event_attendees SET absent = ?, absent_manual = 1 WHERE id = ?").bind(body.absent ? 1 : 0, row.id)
    );
  }

  const status = body.followUpStatus;
  if (status !== undefined && status !== row.follow_up_status) {
    if (!STATUSES.includes(status)) return jsonNoStore({ error: "Statut de relance invalide." }, { status: 400 });
    if (row.is_member) return jsonNoStore({ error: "Le suivi de relance concerne seulement les non-adhérents." }, { status: 400 });

    const email = row.email ? normalizeEmail(row.email) : null;
    if (status === "ne_plus_contacter" && email) {
      writes.push(
        env.DB.prepare("INSERT OR IGNORE INTO contact_optouts (email_hash, created_at) VALUES (?, ?)").bind(await emailHash(email), now),
        env.DB.prepare(
          "UPDATE event_attendees SET follow_up_status = 'ne_plus_contacter' WHERE is_member = 0 AND lower(trim(email)) = ?"
        ).bind(email)
      );
    } else if (row.follow_up_status === "ne_plus_contacter" && email) {
      // Retour arrière (erreur de clic) : l'adresse sort de la liste
      // d'opposition partout où elle avait été appliquée.
      writes.push(
        env.DB.prepare("DELETE FROM contact_optouts WHERE email_hash = ?").bind(await emailHash(email)),
        env.DB.prepare(
          "UPDATE event_attendees SET follow_up_status = 'a_relancer' WHERE follow_up_status = 'ne_plus_contacter' AND is_member = 0 AND lower(trim(email)) = ? AND id <> ?"
        ).bind(email, row.id)
      );
    }
    writes.push(
      env.DB.prepare("UPDATE event_attendees SET follow_up_status = ?, followed_up_at = ? WHERE id = ?")
        .bind(status, status === "relance" ? now : null, row.id)
    );
  }

  if (writes.length) await env.DB.batch(writes);
  return jsonNoStore(await loadList(env, row.event_id));
}

// DELETE /api/attendees/:id — supprime une ligne, sans étape supplémentaire.
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await purgeExpired(env);
  const row = await env.DB.prepare("SELECT event_id FROM event_attendees WHERE id = ?").bind(params.id).first();
  if (!row) return jsonNoStore({ error: "Inscrit introuvable." }, { status: 404 });
  await env.DB.prepare("DELETE FROM event_attendees WHERE id = ?").bind(params.id).run();
  return jsonNoStore(await loadList(env, row.event_id));
}
