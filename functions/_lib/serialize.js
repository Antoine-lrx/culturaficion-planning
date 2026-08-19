export function rowToEvent(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    monthKey: row.month_key,
    date: row.date,
    lieu: row.lieu,
    helloassoSlug: row.helloasso_slug,
    status: row.status,
    proposedBy: row.proposed_by,
    voters: safeParseArray(row.voters),
    notes: row.notes,
    registered: row.registered,
    revenue: row.revenue,
    expenses: row.expenses,
    createdAt: row.created_at,
  };
}

export function rowToCategory(row) {
  return { id: row.id, label: row.label, color: row.color, position: row.position };
}

export function rowToMembership(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    type: row.type,
    seasonKey: row.season_key,
    joinedDate: row.joined_date,
    createdAt: row.created_at,
  };
}

export function rowToAccount(row) {
  return {
    code: row.code,
    label: row.label,
    kind: row.kind,
    autoSource: row.auto_source,
    position: row.position,
    hidden: !!row.hidden,
  };
}

export function rowToEntry(row) {
  return {
    id: row.id,
    exerciseKey: row.exercise_key,
    opDate: row.op_date,
    kind: row.kind,
    accountCode: row.account_code,
    label: row.label,
    amount: row.amount,
    source: "manual",
    createdAt: row.created_at,
  };
}

export function safeParseArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
