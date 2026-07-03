export function rowToEvent(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    monthKey: row.month_key,
    date: row.date,
    lieu: row.lieu,
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

function safeParseArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
