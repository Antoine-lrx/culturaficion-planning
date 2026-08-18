// Helpers partagés par les endpoints /api/accounting/*.
//
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
