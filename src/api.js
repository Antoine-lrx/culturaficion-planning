/* ─────────────────────────────────────────────────────────────
   Client API : parle aux Cloudflare Pages Functions (/api/*).
   Le code d'accès est conservé en sessionStorage (mémoire de
   session) et envoyé dans l'en-tête X-Access-Code à chaque appel.
   La vérification réelle a toujours lieu côté serveur.
   ───────────────────────────────────────────────────────────── */

const CODE_KEY = "culturaficion:access_code";

// Doublé par une variable en mémoire : si sessionStorage est indisponible ou
// bloqué (réglages de confidentialité, extension...), le code reste quand
// même utilisable pour le reste de la page au lieu d'être perdu en silence.
let memoryCode = "";

export function getStoredCode() {
  try {
    return sessionStorage.getItem(CODE_KEY) || memoryCode;
  } catch {
    return memoryCode;
  }
}

export function storeCode(code) {
  memoryCode = code;
  try {
    sessionStorage.setItem(CODE_KEY, code);
  } catch {
    /* stockage indisponible : le code reste en mémoire JS pour cette page */
  }
}

export function clearCode() {
  memoryCode = "";
  try {
    sessionStorage.removeItem(CODE_KEY);
  } catch {}
}

class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.unauthorized = true;
  }
}

async function request(path, { method = "GET", body, code } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-access-code": code ?? getStoredCode(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) throw new UnauthorizedError();

  if (!res.ok) {
    let message = "Erreur serveur (" + res.status + ")";
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch {}
    throw new Error(message);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  verifyCode: (code) => request("/api/auth", { method: "POST", body: { code }, code }),
  getState: () => request("/api/state"),

  createEvent: (ev) => request("/api/events", { method: "POST", body: ev }),
  updateEvent: (id, patch) => request(`/api/events/${id}`, { method: "PUT", body: patch }),
  deleteEvent: (id) => request(`/api/events/${id}`, { method: "DELETE" }),

  createCategory: (cat) => request("/api/categories", { method: "POST", body: cat }),
  updateCategory: (id, patch) => request(`/api/categories/${id}`, { method: "PUT", body: patch }),
  deleteCategory: (id) => request(`/api/categories/${id}`, { method: "DELETE" }),

  updateMeta: (patch) => request("/api/meta", { method: "PUT", body: patch }),

  getHelloAsso: (formSlug) => request(`/api/helloasso/${encodeURIComponent(formSlug)}`),
};
