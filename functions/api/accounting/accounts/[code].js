import { json } from "../../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../../_lib/auth.js";
import { rowToAccount } from "../../../_lib/serialize.js";

// PUT /api/accounting/accounts/:code — renomme ou masque/démasque un poste.
// Le code, le type (produit/charge) et l'alimentation automatique ne se
// modifient pas : seuls le libellé et l'état masqué sont éditables.
export async function onRequestPut({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const code = params.code;
  const existing = await env.DB.prepare("SELECT * FROM acct_accounts WHERE code = ?").bind(code).first();
  if (!existing) return json({ error: "Poste introuvable." }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const label = body.label !== undefined ? String(body.label).trim() || existing.label : existing.label;
  const hidden = body.hidden !== undefined ? (body.hidden ? 1 : 0) : existing.hidden;

  await env.DB.prepare("UPDATE acct_accounts SET label = ?, hidden = ? WHERE code = ?")
    .bind(label, hidden, code).run();

  const row = await env.DB.prepare("SELECT * FROM acct_accounts WHERE code = ?").bind(code).first();
  return json(rowToAccount(row));
}

// DELETE /api/accounting/accounts/:code — refusé pour les postes automatiques
// (7061/61) et pour un poste déjà utilisé par des écritures : on le masque
// plutôt que de le supprimer, pour ne rien casser dans l'historique.
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const code = params.code;
  const existing = await env.DB.prepare("SELECT * FROM acct_accounts WHERE code = ?").bind(code).first();
  if (!existing) return json({ error: "Poste introuvable." }, { status: 404 });

  if (existing.auto_source) {
    return json({ error: "Ce poste est alimenté automatiquement par la Frise et ne peut pas être supprimé." }, { status: 400 });
  }

  const usedRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM acct_entries WHERE account_code = ?").bind(code).first();
  if ((usedRow?.n ?? 0) > 0) {
    return json({ error: "Poste utilisé par des écritures — masquez-le plutôt que de le supprimer." }, { status: 400 });
  }

  await env.DB.prepare("DELETE FROM acct_accounts WHERE code = ?").bind(code).run();
  return json({ ok: true });
}
