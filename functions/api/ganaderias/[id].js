import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToGanaderia } from "../../_lib/serialize.js";
import { geocodeAddress } from "../../_lib/geocode.js";

const COUNTRIES = ["france", "espagne"];
const STATUSES = ["a_contacter", "en_attente", "partenaire"];

// GET /api/ganaderias/:id — détail d'une ganadería.
export async function onRequestGet({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  const row = await env.DB.prepare("SELECT * FROM ganaderias WHERE id = ?").bind(params.id).first();
  if (!row) return json({ error: "Ganadería introuvable." }, { status: 404 });
  return json(rowToGanaderia(row));
}

// PUT /api/ganaderias/:id — modifie une ganadería (regéolocalise si
// l'adresse a changé et qu'aucune coordonnée manuelle n'est fournie).
export async function onRequestPut({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const id = params.id;
  const existing = await env.DB.prepare("SELECT * FROM ganaderias WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Ganadería introuvable." }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  if (body.country !== undefined && !COUNTRIES.includes(body.country)) {
    return json({ error: "Pays invalide (france ou espagne)." }, { status: 400 });
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return json({ error: "Statut invalide." }, { status: 400 });
  }

  const merged = {
    name: body.name !== undefined ? String(body.name).trim() : existing.name,
    country: body.country ?? existing.country,
    address: body.address !== undefined ? body.address : existing.address,
    status: body.status ?? existing.status,
    contactName: body.contactName !== undefined ? body.contactName : existing.contact_name,
    contactPhone: body.contactPhone !== undefined ? body.contactPhone : existing.contact_phone,
    contactInstagram: body.contactInstagram !== undefined ? body.contactInstagram : existing.contact_instagram,
    lastContactDate: body.lastContactDate !== undefined ? body.lastContactDate : existing.last_contact_date,
    comments: body.comments !== undefined ? body.comments : existing.comments,
  };

  let latitude = existing.latitude;
  let longitude = existing.longitude;
  let geocodingFailed = false;

  const manualCoordsProvided = body.latitude !== undefined && body.longitude !== undefined
    && body.latitude !== null && body.longitude !== null && body.latitude !== "" && body.longitude !== "";
  const addressChanged = body.address !== undefined && body.address !== existing.address;

  if (manualCoordsProvided) {
    latitude = Number(body.latitude);
    longitude = Number(body.longitude);
  } else if (addressChanged) {
    if (merged.address) {
      const geo = await geocodeAddress(merged.address, merged.country);
      if (geo) {
        latitude = geo.latitude;
        longitude = geo.longitude;
      } else {
        latitude = null;
        longitude = null;
        geocodingFailed = true;
      }
    } else {
      latitude = null;
      longitude = null;
    }
  }

  await env.DB.prepare(
    `UPDATE ganaderias SET name=?, country=?, address=?, latitude=?, longitude=?, status=?, contact_name=?, contact_phone=?, contact_instagram=?, last_contact_date=?, comments=?, updated_at=?
     WHERE id=?`
  ).bind(
    merged.name, merged.country, merged.address, latitude, longitude, merged.status,
    merged.contactName, merged.contactPhone, merged.contactInstagram, merged.lastContactDate,
    merged.comments, Date.now(), id
  ).run();

  const row = await env.DB.prepare("SELECT * FROM ganaderias WHERE id = ?").bind(id).first();
  const result = rowToGanaderia(row);
  if (geocodingFailed) result.geocodingFailed = true;
  return json(result);
}

// DELETE /api/ganaderias/:id — suppression sans étape supplémentaire (RGPD).
export async function onRequestDelete({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await env.DB.prepare("DELETE FROM ganaderias WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
