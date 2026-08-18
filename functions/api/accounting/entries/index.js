import { json } from "../../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../../_lib/auth.js";
import { rowToEntry } from "../../../_lib/serialize.js";
import { isValidExerciseKey, getEventEntries } from "../../../_lib/accounting.js";

const KINDS = ["produit", "charge"];

// GET /api/accounting/entries?exercise=2025-2026 — journal complet de
// l'exercice : les écritures manuelles ET les recettes/dépenses des
// événements de la Frise (en lecture seule, comptes 7061/61).
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const exercise = url.searchParams.get("exercise");
  if (!isValidExerciseKey(exercise)) {
    return json({ error: "Paramètre 'exercise' requis (ex. 2025-2026)." }, { status: 400 });
  }

  const [manualRes, eventEntries] = await Promise.all([
    env.DB.prepare("SELECT * FROM acct_entries WHERE exercise_key = ? ORDER BY op_date ASC, created_at ASC").bind(exercise).all(),
    getEventEntries(env, exercise),
  ]);

  const manual = manualRes.results.map(rowToEntry);
  const all = [...manual, ...eventEntries].sort((a, b) => (a.opDate || "9999").localeCompare(b.opDate || "9999"));

  return json(all);
}

// POST /api/accounting/entries — ajoute une écriture manuelle (tout ce qui
// n'est pas un événement de la Frise : cotisations, subventions, dons,
// assurances, fournitures…).
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const { id, exerciseKey, opDate, kind, accountCode, label, amount } = body || {};
  if (!id || !exerciseKey || !kind || !accountCode || !label || amount == null) {
    return json({ error: "Champs requis manquants (id, exerciseKey, kind, accountCode, label, amount)." }, { status: 400 });
  }
  if (!isValidExerciseKey(exerciseKey)) {
    return json({ error: "Exercice invalide (ex. 2025-2026)." }, { status: 400 });
  }
  if (!KINDS.includes(kind)) {
    return json({ error: "Type d'écriture invalide (produit ou charge)." }, { status: 400 });
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return json({ error: "Montant invalide : indiquez un nombre positif." }, { status: 400 });
  }

  const account = await env.DB.prepare("SELECT * FROM acct_accounts WHERE code = ?").bind(accountCode).first();
  if (!account) return json({ error: "Poste comptable introuvable." }, { status: 400 });
  if (account.auto_source) {
    return json({ error: "Ce poste est alimenté automatiquement par la Frise — modifiez l'événement plutôt qu'une écriture." }, { status: 400 });
  }
  if (account.kind !== kind) {
    return json({ error: "Le poste choisi ne correspond pas au type (produit/charge)." }, { status: 400 });
  }

  const createdAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO acct_entries (id, exercise_key, op_date, kind, account_code, label, amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, exerciseKey, opDate || null, kind, accountCode, String(label).trim(), amountNum, createdAt).run();

  const row = await env.DB.prepare("SELECT * FROM acct_entries WHERE id = ?").bind(id).first();
  return json(rowToEntry(row), { status: 201 });
}
