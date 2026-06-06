// Shared HTTP helpers for Netlify Functions.
// Files under _lib/ are bundled into functions, not deployed as endpoints.

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const ok = (body) => json(200, body);
export const bad = (message, code = 400) => json(code, { error: message });

// Pull the Bearer token from the Authorization header (case-insensitive).
export function getBearer(event) {
  const h = event.headers?.authorization || event.headers?.Authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
