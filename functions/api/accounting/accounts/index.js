import { json } from "../../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../../_lib/auth.js";
import { rowToAccount } from "../../../_lib/serialize.js";

const KINDS = ["produit", "charge"];

// GET /api/accounting/accounts — liste du plan de comptes (postes masqués inclus).
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const rows = await env.DB.prepare("SELECT * FROM acct_accounts ORDER BY kind ASC, position ASC").all();
  return json(rows.results.map(rowToAccount));
}

// POST /api/accounting/accounts — ajoute un poste manuel au plan de comptes.
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const { code, label, kind } = body || {};
  if (!code || !label || !kind) {
    return json({ error: "Champs requis manquants (code, label, kind)." }, { status: 400 });
  }
  if (!KINDS.includes(kind)) {
    return json({ error: "Type de poste invalide (produit ou charge)." }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT code FROM acct_accounts WHERE code = ?").bind(code).first();
  if (existing) return json({ error: "Ce code de compte existe déjà." }, { status: 409 });

  const posRow = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) AS maxPos FROM acct_accounts WHERE kind = ?")
    .bind(kind).first();
  const position = (posRow?.maxPos ?? -1) + 1;

  await env.DB.prepare(
    "INSERT INTO acct_accounts (code, label, kind, auto_source, position, hidden) VALUES (?, ?, ?, NULL, ?, 0)"
  ).bind(code, label, kind, position).run();

  const row = await env.DB.prepare("SELECT * FROM acct_accounts WHERE code = ?").bind(code).first();
  return json(rowToAccount(row), { status: 201 });
}
