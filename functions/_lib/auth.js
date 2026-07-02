import { json } from "./http.js";

// Le code d'accès partagé est transmis par le frontend dans l'en-tête
// X-Access-Code et comparé ici à la variable d'environnement secrète
// ACCESS_CODE (définie dans les réglages du projet Cloudflare Pages).
// Il n'est jamais stocké ni comparé côté client.
export function isAuthorized(request, env) {
  const code = request.headers.get("x-access-code") || "";
  return Boolean(env.ACCESS_CODE) && code === env.ACCESS_CODE;
}

export function unauthorized() {
  return json({ error: "Code d'accès invalide." }, { status: 401 });
}
