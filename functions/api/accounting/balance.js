import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToBalance } from "../../_lib/serialize.js";
import { isValidExerciseKey } from "../../_lib/accounting.js";

function sanitizeLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => ({ label: String(l?.label || "").trim(), amount: Number(l?.amount) }))
    .filter((l) => l.label && Number.isFinite(l.amount));
}

// GET /api/accounting/balance?exercise=2025-2026 — soldes d'ouverture et
// compléments de bilan saisis par le trésorier pour cet exercice.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const exercise = url.searchParams.get("exercise");
  if (!isValidExerciseKey(exercise)) {
    return json({ error: "Paramètre 'exercise' requis (ex. 2025-2026)." }, { status: 400 });
  }

  const row = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exercise).first();
  return json(rowToBalance(row, exercise));
}

// PUT /api/accounting/balance?exercise=2025-2026 — enregistre trésorerie
// d'ouverture, fonds propres reportés et compléments d'actif/passif saisis
// à la main pour l'exercice.
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
  const existingParsed = rowToBalance(existing, exercise);

  const openingTreasury = body.openingTreasury !== undefined ? Number(body.openingTreasury) || 0 : existingParsed.openingTreasury;
  const openingFunds = body.openingFunds !== undefined ? Number(body.openingFunds) || 0 : existingParsed.openingFunds;
  const manualAssets = body.manualAssets !== undefined ? sanitizeLines(body.manualAssets) : existingParsed.manualAssets;
  const manualLiabilities = body.manualLiabilities !== undefined ? sanitizeLines(body.manualLiabilities) : existingParsed.manualLiabilities;

  await env.DB.prepare(
    `INSERT INTO acct_balance (exercise_key, opening_treasury, opening_funds, manual_assets, manual_liabilities)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(exercise_key) DO UPDATE SET
       opening_treasury = excluded.opening_treasury,
       opening_funds = excluded.opening_funds,
       manual_assets = excluded.manual_assets,
       manual_liabilities = excluded.manual_liabilities`
  ).bind(exercise, openingTreasury, openingFunds, JSON.stringify(manualAssets), JSON.stringify(manualLiabilities)).run();

  const row = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exercise).first();
  return json(rowToBalance(row, exercise));
}
