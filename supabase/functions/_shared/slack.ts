// _shared/slack.ts — failure-only Slack alerting (SUPABASE-SYNC-CRON-SPEC §Q5).
// Webhook lives in Supabase Vault as SLACK_ALERT_WEBHOOK. We alert on throw only,
// to keep the channel quiet; the daily idempotent re-pull is the real safety net.

const WEBHOOK = Deno.env.get("SLACK_ALERT_WEBHOOK");

export async function alertSlack(job: string, error: unknown): Promise<void> {
  if (!WEBHOOK) {
    console.warn("SLACK_ALERT_WEBHOOK not set — skipping Slack alert");
    return;
  }
  const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: *USR sync failed* — \`${job}\`\n\`\`\`${msg.slice(0, 2500)}\`\`\``,
      }),
    });
  } catch (e) {
    console.error("alertSlack failed:", e);
  }
}
