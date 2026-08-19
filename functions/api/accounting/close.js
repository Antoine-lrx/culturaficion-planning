import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { isValidExerciseKey, computeBalance } from "../../_lib/accounting.js";

// POST /api/accounting/close?exercise=2025-2026 — clôture l'exercice : fige
// sa trésorerie et ses fonds propres de clôture (calculés à cet instant) et
// les reporte comme ouverture automatique de l'exercice suivant. Tant qu'un
// exercice n'est pas clôturé, son ouverture reste recalculée en direct.
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const exercise = url.searchParams.get("exercise");
  if (!isValidExerciseKey(exercise)) {
    return json({ error: "Paramètre 'exercise' requis (ex. 2025-2026)." }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exercise).first();
  if (existing?.closed) {
    return json({ error: "Cet exercice est déjà clôturé." }, { status: 400 });
  }

  const balance = await computeBalance(env, exercise);
  const closedAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO acct_balance (exercise_key, opening_treasury, opening_funds, opening_source, manual_assets, manual_liabilities, closed, closed_at, closing_treasury, closing_funds)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(exercise_key) DO UPDATE SET
       closed = 1,
       closed_at = excluded.closed_at,
       closing_treasury = excluded.closing_treasury,
       closing_funds = excluded.closing_funds`
  ).bind(
    exercise,
    existing?.opening_treasury ?? null,
    existing?.opening_funds ?? null,
    existing?.opening_source || "auto",
    existing?.manual_assets ?? null,
    existing?.manual_liabilities ?? null,
    closedAt,
    balance.closingTreasury,
    balance.closingFunds
  ).run();

  const result = await computeBalance(env, exercise);
  return json(result);
}
