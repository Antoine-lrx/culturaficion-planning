import { json } from "../../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../../_lib/auth.js";
import { rowToEntry } from "../../../_lib/serialize.js";
import { isValidExerciseKey } from "../../../_lib/accounting.js";

const KINDS = ["produit", "charge"];

// PUT /api/accounting/entries/:id — modifie une écriture manuelle.
// Les lignes issues des événements (id "event:…") n'existent pas dans cette
// table : elles ne peuvent donc jamais être trouvées ni modifiées ici.
export async function onRequestPut({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const id = params.id;
  const existing = await env.DB.prepare("SELECT * FROM acct_entries WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Écriture introuvable — les lignes issues de la Frise s'éditent depuis l'événement." }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  if (body.exerciseKey !== undefined && !isValidExerciseKey(body.exerciseKey)) {
    return json({ error: "Exercice invalide (ex. 2025-2026)." }, { status: 400 });
  }
  if (body.kind !== undefined && !KINDS.includes(body.kind)) {
    return json({ error: "Type d'écriture invalide (produit ou charge)." }, { status: 400 });
  }

  const merged = {
    exerciseKey: body.exerciseKey ?? existing.exercise_key,
    opDate: body.opDate !== undefined ? body.opDate : existing.op_date,
    kind: body.kind ?? existing.kind,
    accountCode: body.accountCode ?? existing.account_code,
    label: body.label !== undefined ? String(body.label).trim() : existing.label,
    amount: body.amount !== undefined ? Number(body.amount) : existing.amount,
  };
  if (!Number.isFinite(merged.amount) || merged.amount <= 0) {
    return json({ error: "Montant invalide : indiquez un nombre positif." }, { status: 400 });
  }

  if (body.accountCode !== undefined) {
    const account = await env.DB.prepare("SELECT * FROM acct_accounts WHERE code = ?").bind(merged.accountCode).first();
    if (!account) return json({ error: "Poste comptable introuvable." }, { status: 400 });
    if (account.auto_source) {
      return json({ error: "Ce poste est alimenté automatiquement par la Frise — modifiez l'événement plutôt qu'une écriture." }, { status: 400 });
    }
    if (account.kind !== merged.kind) {
      return json({ error: "Le poste choisi ne correspond pas au type (produit/charge)." }, { status: 400 });
    }
  }

  await env.DB.prepare(
    `UPDATE acct_entries SET exercise_key=?, op_date=?, kind=?, account_code=?, label=?, amount=? WHERE id=?`
  ).bind(merged.exerciseKey, merged.opDate, merged.kind, merged.accountCode, merged.label, merged.amount, id).run();

  const row = await env.DB.prepare("SELECT * FROM acct_entries WHERE id = ?").bind(id).first();
  return json(rowToEntry(row));
}

// DELETE /api/accounting/entries/:id — suppression libre, à tout moment.
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await env.DB.prepare("DELETE FROM acct_entries WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
