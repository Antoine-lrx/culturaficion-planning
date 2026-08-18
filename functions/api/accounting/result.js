import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { isValidExerciseKey, computeResult } from "../../_lib/accounting.js";

// GET /api/accounting/result?exercise=2025-2026 — compte de résultat calculé :
// total par poste (produits et charges), écritures manuelles + événements de
// la Frise agrégés, plus le résultat net. Document de travail : à valider
// par le trésorier avant l'assemblée générale.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const exercise = url.searchParams.get("exercise");
  if (!isValidExerciseKey(exercise)) {
    return json({ error: "Paramètre 'exercise' requis (ex. 2025-2026)." }, { status: 400 });
  }

  const result = await computeResult(env, exercise);
  return json(result);
}
