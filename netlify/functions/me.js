// GET /.netlify/functions/me
// Returns the authenticated director profile. Proves the JWT verification +
// email→Google linkage end-to-end. The frontend uses this as "who am I".
import { ok, json } from './_lib/http.js';
import { getDirector } from './_lib/auth.js';

export const handler = async (event) => {
  const res = await getDirector(event);
  if (res.error) return json(res.status || 401, { error: res.error });
  const { director, user } = res;
  return ok({
    id: director.id,
    name: director.name,
    email: director.email,
    org_name: director.org_name,
    is_admin: !!director.is_admin,
    auth_user_id: user.id,
  });
};
