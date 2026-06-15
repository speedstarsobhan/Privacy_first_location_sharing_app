export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env.ALLOWED_ORIGIN || '*')
      });
    }

    if (url.pathname !== '/api/request') {
      return json({ ok: false, error: 'Not found' }, 404, env.ALLOWED_ORIGIN);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, env.ALLOWED_ORIGIN);
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return json({ ok: false, error: 'Invalid content type' }, 415, env.ALLOWED_ORIGIN);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400, env.ALLOWED_ORIGIN);
    }

    const mapsLink = typeof body?.mapsLink === 'string' ? body.mapsLink.trim() : '';
    if (!mapsLink) {
      return json({ ok: false, error: 'mapsLink is required' }, 400, env.ALLOWED_ORIGIN);
    }

    if (!isAllowedMapsUrl(mapsLink)) {
      return json({ ok: false, error: 'Invalid Google Maps link' }, 400, env.ALLOWED_ORIGIN);
    }

    const cf = request.cf || {};
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const fingerprint = await sha256Hex([ip, request.headers.get('user-agent') || '', env.IP_SALT || 'salt'].join('|'));
    const shortFingerprint = fingerprint.slice(0, 12);
    const now = new Date();
    const timeText = formatDateIST(now);

    const riderId = (body?.riderId && typeof body.riderId === 'string' ? body.riderId : url.searchParams.get('riderId') || 'default').trim().slice(0, 48);

    const telegramText = [
      'New destination received',
      '',
      `Rider: ${escapeTelegram(riderId || 'default')}`,
      `Time: ${escapeTelegram(timeText)}`,
      `Approx region: ${escapeTelegram([cf.city, cf.region, cf.country].filter(Boolean).join(', ') || 'Unknown')}`,
      `Request ID: ${escapeTelegram(shortFingerprint)}`,
      '',
      `Maps link: ${escapeTelegram(mapsLink)}`
    ].join('\n');

    const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: telegramText,
        disable_web_page_preview: true
      })
    });

    if (!telegramResponse.ok) {
      return json({ ok: false, error: 'Telegram delivery failed' }, 502, env.ALLOWED_ORIGIN);
    }

    return json({ ok: true }, 200, env.ALLOWED_ORIGIN);
  }
};

function isAllowedMapsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return false;
    if (host === 'maps.app.goo.gl') return true;
    if (host === 'goo.gl') return true;
    if (host === 'google.com' || host === 'www.google.com' || host === 'maps.google.com') return true;
    if (host.endsWith('.google.com')) return true;
    return false;
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };
}

function json(data, status, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin)
    }
  });
}

function formatDateIST(date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(date) + ' IST';
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeTelegram(text) {
  return String(text).replace(/[<>]/g, '');
}
