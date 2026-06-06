// GET /.netlify/functions/hs-read-deal?deal_id=123
// Admin-only proof of the read round-trip through the trust boundary:
// the HubSpot token lives server-side; the browser never sees it.
import { ok, json, bad } from './_lib/http.js';
import { requireAdmin } from './_lib/auth.js';
import { getDeal } from './_lib/hubspot.js';

// Confirmed-safe read properties. (Write allowlist comes in Phase 2.)
const READ_PROPS = [
  'dealname', 'dealstage', 'amount',
  'renewal_status', 'closedate', 'hubspot_owner_id',
];

export const handler = async (event) => {
  const auth = await requireAdmin(event);
  if (auth.error) return json(auth.status || 403, { error: auth.error });

  const dealId = event.queryStringParameters?.deal_id;
  if (!dealId) return bad('deal_id query param required');

  try {
    const deal = await getDeal(dealId, READ_PROPS);
    return ok({ id: deal.id, properties: deal.properties });
  } catch (e) {
    return json(e.status || 502, { error: e.message });
  }
};
