// Auth boundary: verify the caller's Supabase JWT and resolve their director row.
// On first Google login the auth user is new, so we link by email and backfill
// auth_user_id (via the service key, which bypasses RLS).
import { admin } from './supabaseAdmin.js';
import { getBearer } from './http.js';

export async function getDirector(event) {
  const token = getBearer(event);
  if (!token) return { error: 'missing token', status: 401 };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { error: 'invalid token', status: 401 };
  const user = data.user;

  // 1) Match by auth_user_id (the steady-state path).
  let { data: dir } = await admin
    .from('directors').select('*').eq('auth_user_id', user.id).maybeSingle();

  // 2) First Google login: match by email, then backfill auth_user_id.
  if (!dir && user.email) {
    const { data: byEmail } = await admin
      .from('directors').select('*').eq('email', user.email).maybeSingle();
    if (byEmail) {
      await admin.from('directors')
        .update({ auth_user_id: user.id, updated_at: new Date().toISOString() })
        .eq('id', byEmail.id);
      dir = { ...byEmail, auth_user_id: user.id };
    }
  }

  if (!dir) return { error: 'no director profile for this account', status: 403, user };
  return { user, director: dir };
}

export async function requireAdmin(event) {
  const res = await getDirector(event);
  if (res.error) return res;
  if (!res.director.is_admin) return { error: 'admin only', status: 403 };
  return res;
}
