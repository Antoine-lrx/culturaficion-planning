// Géolocalisation d'une adresse via Nominatim (OpenStreetMap), gratuite et
// sans clé API. Appelée uniquement à la sauvegarde d'une ganadería (jamais
// en temps réel), donc aucun risque de dépasser la limite d'une requête par
// seconde imposée par les conditions d'utilisation de Nominatim.
const COUNTRY_CODES = { france: "fr", espagne: "es" };

// Renvoie { latitude, longitude } si l'adresse a pu être géolocalisée,
// ou null sinon (adresse trop vague, service indisponible, etc.).
export async function geocodeAddress(address, country) {
  if (!address) return null;
  const countrycodes = COUNTRY_CODES[country];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  if (countrycodes) url.searchParams.set("countrycodes", countrycodes);

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Culturaficion-App/1.0" },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;
    const lat = Number(results[0].lat);
    const lon = Number(results[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { latitude: lat, longitude: lon };
  } catch {
    return null;
  }
}
