// Helpers partagés pour l'API HelloAsso, réutilisés par la billetterie des
// événements (GET /api/helloasso/:formSlug) ET par la synchronisation des
// adhésions (POST /api/memberships/sync). Le jeton OAuth2 est obtenu une
// seule fois par invocation : on ne duplique jamais cette logique.

export const HELLOASSO_TOKEN_URL = "https://api.helloasso.com/oauth2/token";
export const HELLOASSO_API_BASE = "https://api.helloasso.com/v5";

// Obtention du jeton d'accès HelloAsso (OAuth2 client credentials). Les
// identifiants restent côté serveur, dans les variables d'environnement
// Cloudflare : ils ne sont jamais exposés au frontend.
export async function getAccessToken(env) {
  const res = await fetch(HELLOASSO_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.HELLOASSO_CLIENT_ID,
      client_secret: env.HELLOASSO_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Échec de l'authentification HelloAsso (statut ${res.status}) : ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Jeton HelloAsso absent de la réponse.");
  return data.access_token;
}

// Les montants renvoyés par l'API HelloAsso sont exprimés en CENTIMES. Cette
// conversion en euros est faite à UN SEUL endroit et réutilisée partout où on
// lit un montant HelloAsso (adhésions, dons), pour éviter tout écart d'échelle.
export function centsToEuros(cents) {
  return (Number(cents) || 0) / 100;
}
