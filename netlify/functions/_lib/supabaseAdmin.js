// Service-role Supabase client. SERVER ONLY — bypasses RLS.
// The service key lives in Netlify env and never reaches the browser bundle.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('[functions] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var');
}

export const admin = createClient(url || '', key || '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
