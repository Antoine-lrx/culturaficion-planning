import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { safeParseArray } from "../../_lib/serialize.js";
import { isValidExerciseKey, computeBalance } from "../../_lib/accounting.js";

function sanitizeLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => ({ label: String(l?.label || "").trim(), amount: Number(l?.amount) }))
    .filter((l) => l.label && Number.isFinite(l.amount));
}

// GET /api/accounting/balance?exercise=2025-2026 — bilan calculé de
// l'exercice : ouverture (reportée automatiquement de l'exercice précédent,
// ou saisie/ajustée à la main), trésorerie de clôture, résultat repris,
// compléments manuels et contrôle d'équilibre actif = passif. Le calcul du
// report remonte récursivement jusqu'au premier exercice suivi.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const exercise = url.searchParams.get("exercise");
  if (!isValidExerciseKey(exercise)) {
    return json({ error: "Paramètre 'exercise' requis (ex. 2025-2026)." }, { status: 400 });
  }

  const balance = await computeBalance(env, exercise);
  return json(balance);
}

// PUT /api/accounting/balance?exercise=2025-2026 — enregistre une ouverture
// forcée (trésorerie et/ou fonds propres → opening_source devient 'manual',
// et prime alors sur le report automatique pour cet exercice) et/ou les
// compléments d'actif/passif. Passer { openingSource: 'auto' } revient au
// report automatique. Sert notamment à saisir, une seule fois, l'ouverture
// du tout premier exercice suivi.
export async function onRequestPut({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const exercise = url.searchParams.get("exercise");
  if (!isValidExerciseKey(exercise)) {
    return json({ error: "Paramètre 'exercise' requis (ex. 2025-2026)." }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exercise).first();
  if (existing?.closed) {
    return json({ error: "Exercice clôturé : rouvrez-le avant de modifier le bilan." }, { status: 400 });
  }

  let openingSource = existing?.opening_source || "auto";
  let openingTreasury = existing?.opening_treasury ?? null;
  let openingFunds = existing?.opening_funds ?? null;

  if (body.openingTreasury !== undefined || body.openingFunds !== undefined) {
    openingSource = "manual";
    if (body.openingTreasury !== undefined) openingTreasury = Number(body.openingTreasury) || 0;
    if (body.openingFunds !== undefined) openingFunds = Number(body.openingFunds) || 0;
  } else if (body.openingSource === "auto") {
    openingSource = "auto";
  }

  const manualAssets = body.manualAssets !== undefined ? sanitizeLines(body.manualAssets) : safeParseArray(existing?.manual_assets);
  const manualLiabilities = body.manualLiabilities !== undefined ? sanitizeLines(body.manualLiabilities) : safeParseArray(existing?.manual_liabilities);

  await env.DB.prepare(
    `INSERT INTO acct_balance (exercise_key, opening_treasury, opening_funds, opening_source, manual_assets, manual_liabilities)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(exercise_key) DO UPDATE SET
       opening_treasury = excluded.opening_treasury,
       opening_funds = excluded.opening_funds,
       opening_source = excluded.opening_source,
       manual_assets = excluded.manual_assets,
       manual_liabilities = excluded.manual_liabilities`
  ).bind(exercise, openingTreasury, openingFunds, openingSource, JSON.stringify(manualAssets), JSON.stringify(manualLiabilities)).run();

  const balance = await computeBalance(env, exercise);
  return json(balance);
}
