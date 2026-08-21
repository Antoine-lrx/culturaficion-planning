// Géolocalisation d'une adresse via Nominatim (OpenStreetMap), gratuite et
// sans clé API. Appelée uniquement à la sauvegarde d'une ganadería (jamais
// en temps réel), donc aucun risque de dépasser la limite d'une requête par
// seconde imposée par les conditions d'utilisation de Nominatim.
const COUNTRY_CODES = { france: "fr", espagne: "es" };

// Délai maximum de l'appel réseau. Nominatim peut être lent ou injoignable
// depuis les IP de Cloudflare : sans borne, la requête pourrait rester
// bloquée jusqu'à ce que la plateforme la coupe (erreur 500). On préfère
// abandonner la géolocalisation au bout de quelques secondes et laisser
// l'utilisateur saisir les coordonnées à la main.
const GEOCODE_TIMEOUT_MS = 5000;

// Renvoie { latitude, longitude, city } si l'adresse a pu être géolocalisée,
// ou null sinon (adresse trop vague, service indisponible, trop lent...).
// `city` peut être null même en cas de succès si Nominatim ne renvoie pas de
// ville exploitable pour l'adresse fournie.
export async function geocodeAddress(address, country) {
  if (!address) return null;
  const countrycodes = COUNTRY_CODES[country];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  // addressdetails=1 : demande à Nominatim de détailler les composants de
  // l'adresse (ville, village...) pour pré-remplir le champ `city`.
  url.searchParams.set("addressdetails", "1");
  if (countrycodes) url.searchParams.set("countrycodes", countrycodes);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Culturaficion-App/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;
    const lat = Number(results[0].lat);
    const lon = Number(results[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const addr = results[0].address || {};
    const city = addr.city || addr.town || addr.village || addr.municipality || null;
    return { latitude: lat, longitude: lon, city };
  } catch {
    // Échec réseau, réponse non-JSON, ou délai dépassé (AbortError) :
    // dans tous les cas on renvoie null pour ne jamais bloquer la sauvegarde.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
