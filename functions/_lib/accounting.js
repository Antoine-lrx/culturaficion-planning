// Helpers partagés par les endpoints /api/accounting/*.
import { safeParseArray } from "./serialize.js";

// Un exercice ("2025-2026") va de septembre de l'année de départ à août de
// l'année suivante. Les month_key des événements sont au format "YYYY-MM",
// qui trie lexicographiquement comme une date : on peut donc borner
// l'exercice avec une simple comparaison de chaînes en SQL.
export function exerciseBounds(exerciseKey) {
  const y1 = Number(String(exerciseKey).split("-")[0]);
  return { start: `${y1}-09`, end: `${y1 + 1}-08` };
}

export function isValidExerciseKey(exerciseKey) {
  return typeof exerciseKey === "string" && /^\d{4}-\d{4}$/.test(exerciseKey);
}

export function previousExerciseKey(exerciseKey) {
  const y1 = Number(String(exerciseKey).split("-")[0]);
  return `${y1 - 1}-${y1}`;
}

// Les événements de la Frise alimentent automatiquement 7061 (recettes) et
// 61 (dépenses) : on les représente comme des écritures en lecture seule,
// une par événement et par sens, détaillées (pas de double saisie possible).
export async function getEventEntries(env, exerciseKey) {
  const { start, end } = exerciseBounds(exerciseKey);
  const rows = await env.DB.prepare(
    "SELECT id, title, month_key, date, revenue, expenses FROM events WHERE month_key >= ? AND month_key <= ? ORDER BY month_key ASC, date ASC"
  ).bind(start, end).all();

  const entries = [];
  for (const r of rows.results) {
    if (r.revenue != null) {
      entries.push({
        id: `event:${r.id}:revenue`,
        exerciseKey,
        opDate: r.date,
        kind: "produit",
        accountCode: "7061",
        label: r.title,
        amount: Number(r.revenue),
        source: "event",
        eventId: r.id,
        monthKey: r.month_key,
      });
    }
    if (r.expenses != null) {
      entries.push({
        id: `event:${r.id}:expense`,
        exerciseKey,
        opDate: r.date,
        kind: "charge",
        accountCode: "61",
        label: r.title,
        amount: Number(r.expenses),
        source: "event",
        eventId: r.id,
        monthKey: r.month_key,
      });
    }
  }
  return entries;
}

// Un exercice a-t-il la moindre trace en base (bilan, écritures ou
// événements) ? Sert à distinguer le tout premier exercice suivi (aucune
// donnée avant lui) d'un exercice simplement pas encore renseigné.
async function exerciseHasData(env, exerciseKey) {
  const { start, end } = exerciseBounds(exerciseKey);
  const [balanceRow, entryRow, eventRow] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM acct_balance WHERE exercise_key = ?").bind(exerciseKey).first(),
    env.DB.prepare("SELECT 1 FROM acct_entries WHERE exercise_key = ? LIMIT 1").bind(exerciseKey).first(),
    env.DB.prepare("SELECT 1 FROM events WHERE month_key >= ? AND month_key <= ? LIMIT 1").bind(start, end).first(),
  ]);
  return Boolean(balanceRow || entryRow || eventRow);
}

// Résout l'ouverture (trésorerie + fonds propres) d'un exercice : reportée
// automatiquement de la clôture de l'exercice précédent (report à nouveau),
// sauf si le trésorier a forcé une valeur manuelle pour cet exercice précis.
// Remonte récursivement la chaîne jusqu'au premier exercice suivi, dont
// l'ouverture est nécessairement saisie à la main (rien à reporter avant).
export async function resolveOpening(env, exerciseKey, depth = 0) {
  if (depth > 60) {
    // Garde-fou : chaîne anormalement longue (ou en boucle). On arrête là
    // plutôt que de saturer les requêtes D1.
    return { openingTreasury: 0, openingFunds: 0, source: "manual", fromExercise: null, needsFirstEntry: false };
  }

  const row = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exerciseKey).first();
  if (row && row.opening_source === "manual") {
    return {
      openingTreasury: row.opening_treasury || 0,
      openingFunds: row.opening_funds || 0,
      source: "manual",
      fromExercise: null,
      needsFirstEntry: false,
    };
  }

  const prevKey = previousExerciseKey(exerciseKey);
  const prevHasData = await exerciseHasData(env, prevKey);
  if (!prevHasData) {
    return { openingTreasury: 0, openingFunds: 0, source: "none", fromExercise: null, needsFirstEntry: true };
  }

  const prevRow = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(prevKey).first();

  let prevClosingTreasury;
  let prevClosingFunds;
  if (prevRow && prevRow.closed) {
    // Exercice précédent clôturé : ses chiffres sont figés au moment de la
    // clôture, on les reprend tels quels même si une écriture y a été
    // modifiée par erreur depuis.
    prevClosingTreasury = prevRow.closing_treasury || 0;
    prevClosingFunds = prevRow.closing_funds || 0;
  } else {
    const [prevOpening, prevResult] = await Promise.all([
      resolveOpening(env, prevKey, depth + 1),
      computeResult(env, prevKey),
    ]);
    prevClosingTreasury = prevOpening.openingTreasury + prevResult.totalProduits - prevResult.totalCharges;
    prevClosingFunds = prevOpening.openingFunds + prevResult.net;
  }

  return { openingTreasury: prevClosingTreasury, openingFunds: prevClosingFunds, source: "auto", fromExercise: prevKey, needsFirstEntry: false };
}

// Bilan complet calculé d'un exercice : ouverture (reportée automatiquement
// ou saisie/ajustée à la main), trésorerie et fonds propres de clôture,
// compléments manuels d'actif/passif et contrôle d'équilibre actif = passif.
export async function computeBalance(env, exerciseKey) {
  const [row, opening, result] = await Promise.all([
    env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exerciseKey).first(),
    resolveOpening(env, exerciseKey),
    computeResult(env, exerciseKey),
  ]);

  const manualAssets = safeParseArray(row?.manual_assets);
  const manualLiabilities = safeParseArray(row?.manual_liabilities);
  const sumLines = (lines) => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const closed = Boolean(row?.closed);
  // Une fois clôturé, on réaffiche la trésorerie/fonds propres de clôture
  // figés au moment de la clôture plutôt que de les recalculer en direct :
  // les chiffres présentés à l'AG ne bougent plus, même si une écriture
  // antérieure est modifiée par erreur après coup.
  const closingTreasury = closed ? (row.closing_treasury || 0) : opening.openingTreasury + result.totalProduits - result.totalCharges;
  const closingFunds = closed ? (row.closing_funds || 0) : opening.openingFunds + result.net;
  const totalActif = closingTreasury + sumLines(manualAssets);
  const totalPassif = closingFunds + sumLines(manualLiabilities);

  return {
    exercise: exerciseKey,
    openingTreasury: opening.openingTreasury,
    openingFunds: opening.openingFunds,
    openingSource: opening.source,
    openingFromExercise: opening.fromExercise,
    needsFirstEntry: opening.needsFirstEntry,
    closingTreasury,
    closingFunds,
    net: result.net,
    manualAssets,
    manualLiabilities,
    totalActif,
    totalPassif,
    diff: totalActif - totalPassif,
    balanced: Math.abs(totalActif - totalPassif) < 0.01,
    closed,
    closedAt: row?.closed_at || null,
  };
}

// Compte de résultat de l'exercice : total par poste (produits, charges),
// en agrégeant les écritures manuelles et les recettes/dépenses des
// événements de la Frise, plus le résultat net.
export async function computeResult(env, exerciseKey) {
  const [accountsRes, manualRes, eventEntries] = await Promise.all([
    env.DB.prepare("SELECT * FROM acct_accounts ORDER BY position ASC").all(),
    env.DB.prepare(
      "SELECT account_code, SUM(amount) AS total FROM acct_entries WHERE exercise_key = ? GROUP BY account_code"
    ).bind(exerciseKey).all(),
    getEventEntries(env, exerciseKey),
  ]);

  const totals = {};
  for (const row of manualRes.results) totals[row.account_code] = (totals[row.account_code] || 0) + Number(row.total || 0);
  for (const e of eventEntries) totals[e.accountCode] = (totals[e.accountCode] || 0) + e.amount;

  const toLine = (a) => ({ code: a.code, label: a.label, hidden: !!a.hidden, total: totals[a.code] || 0 });
  const produits = accountsRes.results.filter((a) => a.kind === "produit").map(toLine);
  const charges = accountsRes.results.filter((a) => a.kind === "charge").map(toLine);
  const totalProduits = produits.reduce((s, a) => s + a.total, 0);
  const totalCharges = charges.reduce((s, a) => s + a.total, 0);

  return {
    exercise: exerciseKey,
    produits,
    charges,
    totalProduits,
    totalCharges,
    net: totalProduits - totalCharges,
  };
}
