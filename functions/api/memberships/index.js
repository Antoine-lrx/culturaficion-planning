import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToMembership } from "../../_lib/serialize.js";

const TYPES = ["tendido", "practicos"];

// GET /api/memberships?season=2025-2026 — liste des adhérents d'une saison.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const season = url.searchParams.get("season");
  if (!season) return json({ error: "Paramètre 'season' requis." }, { status: 400 });

  const rows = await env.DB.prepare(
    "SELECT * FROM memberships WHERE season_key = ? ORDER BY last_name COLLATE NOCASE ASC, first_name COLLATE NOCASE ASC"
  ).bind(season).all();

  return json(rows.results.map(rowToMembership));
}

// POST /api/memberships — ajoute un adhérent (un type par saison, une ligne par type).
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const { id, firstName, lastName, type, seasonKey, joinedDate } = body || {};
  if (!id || !firstName || !lastName || !type || !seasonKey) {
    return json({ error: "Champs requis manquants (id, firstName, lastName, type, seasonKey)." }, { status: 400 });
  }
  if (!TYPES.includes(type)) {
    return json({ error: "Type d'adhésion invalide (tendido ou practicos)." }, { status: 400 });
  }

  const createdAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO memberships (id, first_name, last_name, type, season_key, joined_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, firstName.trim(), lastName.trim(), type, seasonKey, joinedDate || null, createdAt).run();

  const row = await env.DB.prepare("SELECT * FROM memberships WHERE id = ?").bind(id).first();
  return json(rowToMembership(row), { status: 201 });
}
