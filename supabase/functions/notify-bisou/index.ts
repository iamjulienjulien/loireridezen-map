import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const PUSHOVER_USER = Deno.env.get('PUSHOVER_USER_KEY');
const PUSHOVER_TOKEN = Deno.env.get('PUSHOVER_APP_TOKEN');
const RATE_LIMIT_MS = 60_000;
const PUSHOVER_API = 'https://api.pushover.net/1/messages.json';

let lastNotificationAt = 0;

serve(async (req) => {
  if (!PUSHOVER_USER || !PUSHOVER_TOKEN) {
    console.error('[notify-bisou] Missing PUSHOVER_USER_KEY or PUSHOVER_APP_TOKEN');
    return new Response(
      JSON.stringify({ error: 'missing_credentials' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const now = Date.now();
  if (now - lastNotificationAt < RATE_LIMIT_MS) {
    console.log('[notify-bisou] Skipped (rate limited)');
    return new Response(
      JSON.stringify({ skipped: true, reason: 'rate_limited' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let sentAt: Date;
  try {
    const body = await req.json();
    sentAt = body?.record?.sent_at ? new Date(body.record.sent_at) : new Date();
  } catch {
    sentAt = new Date();
  }

  const heure = sentAt.toLocaleString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

  try {
    const resp = await fetch(PUSHOVER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: PUSHOVER_TOKEN,
        user: PUSHOVER_USER,
        title: '💗 Un bisou pour Papa',
        message: `Elle vient de penser à toi · ${heure}`,
        sound: 'magic',
        url: 'https://carte.loireridezen.link/?for=elle',
        url_title: 'Voir sa carte',
        priority: 0,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[notify-bisou] Pushover error ${resp.status}: ${errText}`);
      return new Response(
        JSON.stringify({ sent: false, status: resp.status }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    lastNotificationAt = now;
    console.log(`[notify-bisou] Sent at ${heure}`);
    return new Response(
      JSON.stringify({ sent: true, heure }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[notify-bisou] Network error', err);
    return new Response(
      JSON.stringify({ sent: false, error: 'network' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
