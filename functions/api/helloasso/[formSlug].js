import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";

const TOKEN_URL = "https://api.helloasso.com/oauth2/token";
const API_BASE = "https://api.helloasso.com/v5";

// Nom de l'état HelloAsso correspondant à un paiement validé. À confirmer
// en sandbox (voir README) — les valeurs possibles observées sur l'API
// HelloAsso sont proches de "Processed" mais peuvent varier légèrement.
const VALID_STATE = "processed";

// GET /api/helloasso/:formSlug — agrège, pour une billetterie HelloAsso
// donnée, le nombre d'inscriptions et les recettes validées. Ne renvoie
// jamais les données individuelles (noms, emails) des payeurs.
export async function onRequestGet({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const formSlug = params.formSlug;
  if (!formSlug) return json({ error: "Identifiant HelloAsso manquant." }, { status: 400 });

  if (!env.HELLOASSO_CLIENT_ID || !env.HELLOASSO_CLIENT_SECRET || !env.HELLOASSO_ORG_SLUG) {
    return json({ error: "Intégration HelloAsso non configurée." }, { status: 503 });
  }

  try {
    const accessToken = await getAccessToken(env);
    const aggregates = await fetchAggregates(env, formSlug, accessToken);
    return json(aggregates);
  } catch {
    return json({ error: "Données HelloAsso indisponibles." }, { status: 502 });
  }
}

async function getAccessToken(env) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.HELLOASSO_CLIENT_ID,
      client_secret: env.HELLOASSO_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error("Échec de l'authentification HelloAsso.");
  const data = await res.json();
  if (!data.access_token) throw new Error("Jeton HelloAsso absent de la réponse.");
  return data.access_token;
}

async function fetchAggregates(env, formSlug, accessToken) {
  const formType = env.HELLOASSO_FORM_TYPE || "Event";
  const orgSlug = env.HELLOASSO_ORG_SLUG;

  let registered = 0;
  let revenueCents = 0;
  let continuationToken = "";

  do {
    const url = new URL(
      `${API_BASE}/organizations/${orgSlug}/forms/${formType}/${formSlug}/items`
    );
    url.searchParams.set("pageSize", "100");
    if (continuationToken) url.searchParams.set("continuationToken", continuationToken);

    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error("Appel à l'API HelloAsso en échec.");
    const data = await res.json();

    for (const item of data.data || []) {
      if (String(item.state || "").toLowerCase() === VALID_STATE) {
        registered += 1;
        revenueCents += Number(item.amount) || 0;
      }
    }

    continuationToken = (data.pagination && data.pagination.continuationToken) || "";
  } while (continuationToken);

  return { registered, revenue: Math.round(revenueCents) / 100 };
}
