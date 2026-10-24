import type {MsilReadStage} from './msil-public';
export type MsilFailureCategory='DEADLINE'|'CALLER_ABORT'|'REQUEST_OPTION_UNSUPPORTED'|'TYPE_ERROR'|'DNS_FAILURE'|'CONNECTION_REFUSED'|'CONNECTION_FAILURE'|'ROUTING_OR_PERMISSION_REJECTED'|'REDIRECT_REJECTED'|'HTTP_CHECK_FAILED'|'JSON_ERROR'|'EVIDENCE_CHECK_FAILED'|'FETCH_REJECTED'|'UNKNOWN';
/** Fixed categories only. Never return exception text, URLs, headers, bodies or arbitrary error names. */
export function classifyMsilFailure(error:unknown,stage:MsilReadStage):MsilFailureCategory{
 if(stage==='DEADLINE'||stage==='CALLER_ABORT')return stage;
 try{
  const value=error&&typeof error==='object'?error as Record<string,unknown>:{};
  const name=typeof value.name==='string'?value.name:'';
  const message=typeof value.message==='string'?value.message.slice(0,1024):'';
  const cause=value.cause&&typeof value.cause==='object'?value.cause as Record<string,unknown>:{};
  const code=typeof cause.code==='string'?cause.code:typeof value.code==='string'?value.code:'';
  if(stage.endsWith('_FETCH')){
   if(/^(?:The ['"](?:credentials|cache|mode|referrer|referrerPolicy|keepalive|window)['"] field on ['"]RequestInitializerDict['"] is not implemented\.?|Unsupported (?:cache|redirect) mode: [a-z-]+)$/i.test(message))return 'REQUEST_OPTION_UNSUPPORTED';
   if(code==='ENOTFOUND'||code==='EAI_AGAIN')return 'DNS_FAILURE';
   if(code==='ECONNREFUSED')return 'CONNECTION_REFUSED';
   if(['ECONNRESET','ETIMEDOUT','ECONNABORTED','ENETUNREACH','EHOSTUNREACH'].includes(code))return 'CONNECTION_FAILURE';
   if(/^(?:Cross-account requests are not allowed\.?|Outbound request (?:denied|blocked)\.?|Permission denied\.?)$/i.test(message))return 'ROUTING_OR_PERMISSION_REJECTED';
   if(/^Unexpected redirect\.?$/i.test(message)||code==='ERR_REDIRECT')return 'REDIRECT_REJECTED';
  }
  if(name==='TypeError')return 'TYPE_ERROR';
  if(stage.endsWith('_HTTP'))return 'HTTP_CHECK_FAILED';
  if(name==='SyntaxError'&&stage.endsWith('_JSON'))return 'JSON_ERROR';
  if(stage.startsWith('VERIFY_'))return 'EVIDENCE_CHECK_FAILED';
  return stage.endsWith('_FETCH')?'FETCH_REJECTED':'UNKNOWN';
 }catch{return 'UNKNOWN';}
}
