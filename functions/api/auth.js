import { json } from "../_lib/http.js";

// POST /api/auth — vérifie le code d'accès saisi à l'écran de connexion.
// Ne lit ni n'écrit aucune donnée : sert uniquement à valider le code
// avant que le frontend ne le conserve en mémoire de session.
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const code = (body && body.code) || "";
  if (env.ACCESS_CODE && code === env.ACCESS_CODE) {
    return json({ ok: true });
  }
  return json({ ok: false }, { status: 401 });
}
