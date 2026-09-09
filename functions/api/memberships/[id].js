import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToMembership } from "../../_lib/serialize.js";

const TYPES = ["tendido", "practicos"];
const TARIFS = ["plein", "jeune"];

// PUT /api/memberships/:id — modifie un adhérent SAISI À LA MAIN.
// Les lignes issues de HelloAsso (source='helloasso') ne sont pas modifiables :
// leurs champs viennent de la source, on corrige dans HelloAsso puis on
// resynchronise. Elles restent en revanche supprimables (RGPD, DELETE).
export async function onRequestPut({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const id = params.id;
  const existing = await env.DB.prepare("SELECT * FROM memberships WHERE id = ?").bind(id).first();
  if (!existing || existing.is_deleted) return json({ error: "Adhérent introuvable." }, { status: 404 });

  if (existing.source === "helloasso") {
    return json({ error: "Une adhésion HelloAsso n'est pas modifiable ici : corrigez-la dans HelloAsso puis resynchronisez." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  if (body.type !== undefined && !TYPES.includes(body.type)) {
    return json({ error: "Type d'adhésion invalide (tendido ou practicos)." }, { status: 400 });
  }

  let tarif = existing.tarif ?? null;
  if (body.tarif !== undefined) {
    tarif = body.tarif == null || body.tarif === "" ? null : body.tarif;
    if (tarif !== null && !TARIFS.includes(tarif)) {
      return json({ error: "Tarif invalide (plein, jeune ou non précisé)." }, { status: 400 });
    }
  }

  let amount = existing.amount ?? null;
  if (body.amount !== undefined) {
    if (body.amount == null || body.amount === "") {
      amount = null;
    } else {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return json({ error: "Montant invalide : indiquez un nombre positif ou laissez vide." }, { status: 400 });
      }
    }
  }

  const merged = {
    firstName: body.firstName !== undefined ? String(body.firstName).trim() : existing.first_name,
    lastName: body.lastName !== undefined ? String(body.lastName).trim() : existing.last_name,
    type: body.type ?? existing.type,
    seasonKey: body.seasonKey ?? existing.season_key,
    joinedDate: body.joinedDate !== undefined ? body.joinedDate : existing.joined_date,
  };

  await env.DB.prepare(
    `UPDATE memberships SET first_name=?, last_name=?, type=?, tarif=?, amount=?, season_key=?, joined_date=? WHERE id=?`
  ).bind(merged.firstName, merged.lastName, merged.type, tarif, amount, merged.seasonKey, merged.joinedDate, id).run();

  const row = await env.DB.prepare("SELECT * FROM memberships WHERE id = ?").bind(id).first();
  return json(rowToMembership(row));
}

// DELETE /api/memberships/:id — suppression sans étape supplémentaire (RGPD).
// - source='manuel'   : suppression pure et simple, comme historiquement.
// - source='helloasso': pierre tombale — on efface toute donnée personnelle
//   (prénom, nom, montant, libellé, date) et on garde uniquement
//   l'identifiant technique HelloAsso + is_deleted=1, pour que la
//   synchronisation ignore définitivement cet article et ne le recrée pas.
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const existing = await env.DB.prepare("SELECT source FROM memberships WHERE id = ?").bind(params.id).first();

  if (existing && existing.source === "helloasso") {
    await env.DB.prepare(
      `UPDATE memberships
         SET first_name = '', last_name = '', amount = NULL, tier_name = NULL,
             joined_date = NULL, is_deleted = 1
       WHERE id = ?`
    ).bind(params.id).run();
    return json({ ok: true, tombstoned: true });
  }

  await env.DB.prepare("DELETE FROM memberships WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
