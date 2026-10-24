// Persist only enumerated diagnostics. Never retain thrown text, URLs, headers,
// bodies, arbitrary names/codes, or a reference to the upstream exception.
const STAGES = new Set(['DOCUMENT_FETCH','LAYER_1_FETCH','LAYER_2_FETCH','LAYER_3_FETCH']);
const CATEGORIES = new Set(['REQUEST_OPTION_UNSUPPORTED','TYPE_ERROR','DNS_FAILURE',
  'CONNECTION_REFUSED','CONNECTION_FAILURE','ROUTING_OR_PERMISSION_REJECTED',
  'REDIRECT_REJECTED','ABORTED','FETCH_REJECTED','UNKNOWN']);
const WORKER_REDIRECT_ERROR = 'Invalid redirect value, must be one of "follow" or "manual" ("error" won\'t be implemented since it does not make sense at the edge; use "manual" and check the response status code).';

export function safeTransportDiagnostic(value) {
  try {
    const stage=value?.stage,category=value?.category;
    return STAGES.has(stage) && CATEGORIES.has(category) ? {stage,category} : null;
  } catch { return null; }
}

export function classifyTransportFailure(error, stage, aborted = false) {
  let category = aborted ? 'ABORTED' : 'UNKNOWN';
  if (!aborted) try {
    const value = error && typeof error === 'object' ? error : {};
    const name = typeof value.name === 'string' ? value.name : '';
    const message = typeof value.message === 'string' ? value.message.slice(0,1024) : '';
    const cause = value.cause && typeof value.cause === 'object' ? value.cause : {};
    const code = typeof cause.code === 'string' ? cause.code : typeof value.code === 'string' ? value.code : '';
    if (message === WORKER_REDIRECT_ERROR || /^(?:The ['"](?:credentials|cache|mode|referrer|referrerPolicy|keepalive|window)['"] field on ['"]RequestInitializerDict['"] is not implemented\.?|Unsupported (?:cache|redirect) mode: [a-z-]+)$/i.test(message)) category = 'REQUEST_OPTION_UNSUPPORTED';
    else if (['ENOTFOUND','EAI_AGAIN'].includes(code)) category = 'DNS_FAILURE';
    else if (code === 'ECONNREFUSED') category = 'CONNECTION_REFUSED';
    else if (['ECONNRESET','ETIMEDOUT','ECONNABORTED','ENETUNREACH','EHOSTUNREACH'].includes(code)) category = 'CONNECTION_FAILURE';
    else if (/^(?:Cross-account requests are not allowed\.?|Outbound request (?:denied|blocked)\.?|Permission denied\.?)$/i.test(message)) category = 'ROUTING_OR_PERMISSION_REJECTED';
    else if (/^Unexpected redirect\.?$/i.test(message) || code === 'ERR_REDIRECT') category = 'REDIRECT_REJECTED';
    else category = name === 'TypeError' ? 'TYPE_ERROR' : 'FETCH_REJECTED';
  } catch { category = 'UNKNOWN'; }
  return safeTransportDiagnostic({stage,category});
}
