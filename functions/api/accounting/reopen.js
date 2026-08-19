import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { isValidExerciseKey, computeBalance } from "../../_lib/accounting.js";

// POST /api/accounting/reopen?exercise=2025-2026 — annule une clôture faite
// par erreur : l'exercice redevient modifiable et ses chiffres de clôture
// sont à nouveau recalculés en direct à chaque consultation.
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const exercise = url.searchParams.get("exercise");
  if (!isValidExerciseKey(exercise)) {
    return json({ error: "Paramètre 'exercise' requis (ex. 2025-2026)." }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exercise).first();
  if (!existing?.closed) {
    return json({ error: "Cet exercice n'est pas clôturé." }, { status: 400 });
  }

  await env.DB.prepare(
    "UPDATE acct_balance SET closed = 0, closed_at = NULL, closing_treasury = NULL, closing_funds = NULL WHERE exercise_key = ?"
  ).bind(exercise).run();

  const result = await computeBalance(env, exercise);
  return json(result);
}
