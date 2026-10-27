// Direct FAA NMS-API access, presented to the Sites code as its "relay".
// The Sites provider POSTs {codes:[code], relaySecret} to NMS_RELAY_URL and
// expects {features, fetchedAt} or {error}. This module answers that call
// in-process, so lib/nms-provider.ts runs unchanged.
//
// Credentials come only from the environment (GitHub Actions secrets):
//   FAA_NMS_CLIENT_ID, FAA_NMS_CLIENT_SECRET
// Optional overrides: FAA_NMS_AUTH_URL, FAA_NMS_API_URL
export const RELAY_URL = 'https://faa-nms.relay.invalid/notams';

const AUTH_URL = process.env.FAA_NMS_AUTH_URL || 'https://api-nms.aim.faa.gov/v1/auth/token';
const API_URL = (process.env.FAA_NMS_API_URL || 'https://api-nms.aim.faa.gov/nmsapi').replace(/\/$/, '');
const TIMEOUT = 25000;

let token = null; // {value, expiresAt}

// Per-location outcome (status codes / short reason, never credentials),
// copied into the collection report so failures can be diagnosed.
export const faaDiagnostics = {};

function secretFree(text) {
  let out = String(text ?? '');
  for (const secret of [process.env.FAA_NMS_CLIENT_ID, process.env.FAA_NMS_CLIENT_SECRET, token?.value]) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[REDACTED]');
  }
  return out.slice(0, 300);
}

async function accessToken(fetcher) {
  if (token && token.expiresAt - 60000 > Date.now()) return token.value;
  const id = process.env.FAA_NMS_CLIENT_ID, secret = process.env.FAA_NMS_CLIENT_SECRET;
  if (!id || !secret) throw Object.assign(new Error('FAA credentials are not configured'), {relay: 'unauthorized: credentials missing'});
  const response = await fetcher(AUTH_URL, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT),
    headers: {Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw Object.assign(new Error(`FAA token HTTP ${response.status}`), {relay: response.status === 429 ? 'rate limit 429' : `unauthorized ${response.status}`});
  const body = await response.json();
  if (!body?.access_token) throw Object.assign(new Error('FAA token response without access_token'), {relay: 'authentication failed'});
  token = {value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 15 * 60000)};
  return token.value;
}

// NMS GeoJSON responses carry features under data.geojson; accept a plain
// FeatureCollection too. Any other shape is reported, never guessed.
export function featuresOf(body) {
  if (Array.isArray(body?.data?.geojson)) return body.data.geojson;
  if (Array.isArray(body?.data?.geojson?.features)) return body.data.geojson.features;
  if (Array.isArray(body?.features)) return body.features;
  // NMS answers a location with no NOTAMs as {status:"Success", data:{}}.
  // Verified against the Sites relay, which stored 0 items for the same codes.
  if (body?.status === 'Success' && body.data && typeof body.data === 'object' && !Array.isArray(body.data) && !Object.keys(body.data).length) return [];
  return null;
}

async function fetchLocation(code, fetcher) {
  const features = [];
  for (let page = 1, pages = 1; page <= pages && page <= 20; page++) {
    const url = new URL(API_URL + '/v1/notams');
    url.searchParams.set('location', code);
    if (page > 1) url.searchParams.set('page', String(page));
    const response = await fetcher(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT),
      headers: {Authorization: 'Bearer ' + await accessToken(fetcher), nmsResponseFormat: 'GEOJSON', Accept: 'application/json'},
    });
    if (response.status === 401) token = null;
    if (!response.ok) throw Object.assign(new Error(`FAA HTTP ${response.status}`), {relay: response.status === 429 ? 'rate limit 429' : response.status === 401 || response.status === 403 ? `unauthorized ${response.status}` : `HTTP ${response.status}`});
    const body = await response.json();
    const found = featuresOf(body);
    if (!found) {
      const data = body?.data, dataShape = data && typeof data === 'object' ? Object.entries(data).map(([k, v]) => `${k}:${Array.isArray(v) ? 'array' + v.length : v === null ? 'null' : typeof v}`).join(',') : String(data);
      throw Object.assign(new Error(`Unrecognised FAA response shape: status=${String(body?.status).slice(0, 20)} data={${dataShape.slice(0, 120)}}`), {relay: 'unrecognised response'});
    }
    features.push(...found);
    const total = Number(body?.data?.totalPages ?? body?.totalPages);
    if (Number.isSafeInteger(total) && total > 1) pages = total;
  }
  return features;
}

// A fetch-compatible function: relay URL calls go to FAA, everything else
// passes through untouched.
export function faaRelayFetcher(base = globalThis.fetch) {
  return async (input, init) => {
    if (String(input) !== RELAY_URL) return base(input, init);
    const {codes} = JSON.parse(init?.body || '{}');
    try {
      const features = (await Promise.all((codes || []).map(code => fetchLocation(code, base)))).flat();
      for (const code of codes || []) faaDiagnostics[code] = {ok: true, features: features.length};
      return Response.json({features, fetchedAt: Date.now()});
    } catch (error) {
      for (const code of codes || []) faaDiagnostics[code] = {ok: false, reason: secretFree(error?.message)};
      console.error('[faa]', secretFree(error?.message));
      return Response.json({error: secretFree(error?.relay || 'FAA request failed')});
    }
  };
}
