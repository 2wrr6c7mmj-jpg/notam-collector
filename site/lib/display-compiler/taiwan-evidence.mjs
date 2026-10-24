import {digest,noticeFingerprint,officialUrl,restoreTaiwanPdf,invalidateTaiwanGeometry,TAIWAN_PDF_MAX_AGE} from './taiwan-pdf-runtime.mjs';

// Only saved evidence on the verified legacy origin. Never fetch a notice URL,
// descriptor readUrl, attachment URL, or Location header.
export const EVIDENCE_ORIGIN='https://notam.cjmrnn9bx9.chatgpt.site';
export const EVIDENCE_LIMITS=Object.freeze({responseBytes:1_900_000,totalBytes:24*1024*1024,requests:160,timeoutMs:25000});
const bytes=s=>new TextEncoder().encode(s).byteLength;
const key=k=>typeof k==='string'&&/^[a-f0-9]{64}$/.test(k);
const check=(v,m)=>{if(!v)throw Error(m);};
const fresh=(t,now)=>Number.isSafeInteger(t)&&t>0&&t<=now&&now-t<=TAIWAN_PDF_MAX_AGE;
const decode=s=>s.replace(/&amp;/gi,'&').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v<=0x10ffff?String.fromCodePoint(v):'\ufffd';}).replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");
export function attachmentMembership(html,articleUrl){
 const clean=html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const lists=[...clean.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi)].filter(m=>/\bclass\s*=\s*(["'])[^"']*\bdownload-list\b[^"']*\1/i.test(m[1]));
 check(lists.length===1,'attachment-list');
 const found=new Map();
 for(const a of lists[0][2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
  const href=a[1].match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];check(href,'attachment-href');
  const url=new URL(decode(href),articleUrl).href,label=decode(a[1]+' '+a[2].replace(/<[^>]*>/g,' '));
  const format=/\bODT\b|\.odt(?:\b|[?#])/i.test(label)?'odt':/\bPDF\b|\.pdf(?:\b|[?#])/i.test(label)?'pdf':'other';
  check(officialUrl(url,'pdf')&&format!=='other','unsupported-attachment');
  // Repeated identical links have one membership, as in the collector.
  check(!found.has(url)||found.get(url).format===format,'ambiguous-attachment');found.set(url,{url,format});
 }
 return [...found.values()];
}
async function boundedJSON(url,{fetcher,signal,budget}){
 signal.throwIfAborted();check(budget.bytes<budget.limits.totalBytes,'byte-budget');check(++budget.requests<=budget.limits.requests,'request-budget');
 const response=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json'},signal});
 check(response.ok&&!response.redirected,'evidence-http');check(!response.url||response.url===url,'evidence-response-url');
 check(/application\/json/i.test(response.headers.get('content-type')||''),'evidence-content-type');
 const length=response.headers.get('content-length');if(length)check(Number.isSafeInteger(+length)&&+length>=0&&+length<=budget.limits.responseBytes,'response-budget');
 const reader=response.body?.getReader();check(reader,'evidence-empty');let size=0;const chunks=[];
 const abort=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;budget.bytes+=value.byteLength;check(size<=budget.limits.responseBytes&&budget.bytes<=budget.limits.totalBytes,'byte-budget');chunks.push(value);}}
 finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
 if(length&&!response.headers.get('content-encoding'))check(+length===size,'truncated-evidence');
 const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));check(value.schemaVersion===1,'envelope-version');return value;
}
async function revision(read,revisionKey,n,kind,sourceUrl){
 check(key(revisionKey),'revision-key');const r=(await read('revisionKey',revisionKey)).revision;
 check(r&&r.schemaVersion===1&&r.revisionKey===revisionKey&&r.kind===kind&&r.sourceId==='tw-fisheries'&&r.articleId===n.id&&r.sourceUrl===sourceUrl,'revision-owner');
 const {revisionKey:ignored,bytes:declared,...value}=r,serialized=JSON.stringify(value);
 check(Number.isSafeInteger(declared)&&declared===bytes(serialized)&&declared<=1_800_000&&await digest(serialized)===revisionKey,'revision-integrity');
 check(r.body&&typeof r.body==='object'&&!Array.isArray(r.body),'revision-body');return r.body;
}
function rejected(n,reason){
 const {taiwanPdf:old,...base}=restoreTaiwanPdf(n);
 return {...invalidateTaiwanGeometry(base),taiwanPdf:{schemaVersion:1,evidenceSchemaVersion:2,status:'review-needed',reason,documents:[]},taiwanEvidenceHydration:{status:'review-needed',reason}};
}
/** @param {any} maritime @param {{fetcher?:typeof fetch,signal?:AbortSignal,now?:number,limits?:Partial<typeof EVIDENCE_LIMITS>}} options */
export async function hydrateTaiwanEvidence(maritime,{fetcher=fetch,signal,now=Date.now(),limits={}}={}){
 const candidates=maritime.items.some(n=>n.sourceCountry==='TW'&&n.taiwanEvidence?.schemaVersion===2);
 if(!candidates)return maritime;
 const cap=maritime.evidenceApi;
 const supported=cap?.schemaVersion===1&&cap.sourceId==='tw-fisheries'&&cap.path==='/api/nav-evidence'&&cap.articleSchemaVersion===2;
 // A shared bounded sequential reader stops starting jobs after timeout/budget exhaustion.
 const bounded=Object.fromEntries(Object.entries(EVIDENCE_LIMITS).map(([k,v])=>[k,Math.min(v,limits[k]??v)]));
 const local=AbortSignal.timeout(bounded.timeoutMs),combined=signal?AbortSignal.any([signal,local]):local;
 const budget={requests:0,bytes:0,limits:bounded};
 const read=(field,id)=>boundedJSON(`${EVIDENCE_ORIGIN}/api/nav-evidence?${field}=${encodeURIComponent(id)}`,{fetcher,signal:combined,budget});
 const items=[];
 for(const original of maritime.items){
  if(original.sourceCountry!=='TW'||original.taiwanEvidence?.schemaVersion!==2){items.push(original);continue;}
  try{
   signal?.throwIfAborted();check(supported,'capability-unverified');combined.throwIfAborted();
   const n=restoreTaiwanPdf(original),d=n.taiwanEvidence;
   check(/^TW-FA-\d+$/.test(n.id)&&d.articleId===n.id&&d.sourceId==='tw-fisheries'&&officialUrl(n.sourceUrl,'article')&&new URL(n.sourceUrl).searchParams.get('id')===n.id.slice(6),'notice-owner');
   check(d.complete===true&&d.status==='complete'&&fresh(d.checkedAt,now),'descriptor-incomplete');
   const state=(await read('articleId',n.id)).article;
   check(state?.schemaVersion===2&&state.sourceId==='tw-fisheries'&&state.articleId===n.id&&state.articleUrl===n.sourceUrl&&state.fingerprint===n.text,'notice-fingerprint');
   check(Number.isSafeInteger(state.generation)&&state.generation>0&&state.membershipVerified===true&&state.lifecycleUncertain===false&&!state.articleError&&!state.removedFromRss&&Array.isArray(state.reviewReasons)&&!state.reviewReasons.length&&!n.cancelled&&!n.lifecycleUncertain,'article-lifecycle');
   check([state.checkedAt,state.completeAt,state.articleCheckedAt].every(t=>fresh(t,now))&&state.completeAt<=state.checkedAt,'article-freshness');
   check(Array.isArray(state.attachments)&&state.attachments.length>0&&state.attachments.length+2<=bounded.requests-budget.requests,'attachment-budget');
   check(state.attachments.every(a=>['pdf','odt'].includes(a.format)&&a.status==='ready'&&key(a.revisionKey)&&fresh(a.checkedAt,now)&&a.checkedAt<=state.completeAt&&a.textExtracted!==false&&a.downloaded!==false&&officialUrl(a.url,'pdf')),'attachment-incomplete');
   const article=await revision(read,state.articleRevisionKey,n,'article-html',n.sourceUrl);
   check(typeof article.html==='string'&&bytes(article.html)<=512*1024&&article.htmlSha256===await digest(article.html),'article-integrity');
   const membership=attachmentMembership(article.html,n.sourceUrl);
   check(JSON.stringify(membership)===JSON.stringify(state.attachments.map(({url,format})=>({url,format}))),'attachment-membership');
   const documents=[],otherDocuments=[];
   for(const a of state.attachments){
    const body=await revision(read,a.revisionKey,n,a.format==='pdf'?'pdf-text':'odt-text',a.url);
    check(body.sourceUrl===a.url,'body-source');
    if(a.format==='pdf'){
     check(body.checkedAt===0&&body.extractionStatus==='ok'&&Number.isSafeInteger(body.byteLength)&&body.byteLength>0&&body.byteLength<=2*1024*1024&&key(body.pdfSha256)&&Array.isArray(body.pages)&&body.pages.length>0&&body.pages.length<=20&&body.pages.every(p=>typeof p==='string'&&p.length<=100000)&&body.pages.some(p=>p.trim())&&body.pages.join('').length<=250000&&body.pagesSha256===await digest(JSON.stringify(body.pages)),'pdf-integrity');
     check(typeof body.extraction==='string'&&Array.isArray(body.layout)&&body.layout.length===body.pages.length&&body.layout.every((p,i)=>p.page===i+1&&Number.isSafeInteger(p.rotatedItems)&&p.rotatedItems>=0&&Array.isArray(p.rotatedText)&&p.rotatedText.length===p.rotatedItems&&p.rotatedText.every(t=>typeof t==='string')),'pdf-layout');
     documents.push({...body,checkedAt:a.checkedAt});
    }else{
     check(key(body.bodySha256)&&typeof body.text==='string'&&body.text.length>0,'odt-integrity');otherDocuments.push({sourceUrl:a.url,text:body.text,checkedAt:a.checkedAt,...(!body.parserError&&body.summary?{summary:body.summary}:{})});
    }
   }
   check(d.pdfDiscovered===documents.length&&d.pdfTextRead===documents.length,'pdf-count');
   check(JSON.stringify((await read('articleId',n.id)).article)===JSON.stringify(state),'article-changed-during-read');
   const packet={schemaVersion:1,status:'ok',evidenceSchemaVersion:2,articleUrl:n.sourceUrl,noticeSha256:await digest(noticeFingerprint(n)),checkedAt:state.completeAt,articleCheckedAt:state.articleCheckedAt,articleEvidence:{url:n.sourceUrl,checkedAt:state.articleCheckedAt,...article},documents,otherDocuments,...(otherDocuments.length===1&&JSON.stringify(otherDocuments[0].summary)===JSON.stringify(state.summary)&&state.summary?{sourceSummary:state.summary}:{})};
   items.push({...n,taiwanPdf:packet,taiwanEvidenceHydration:{status:'verified',generation:state.generation,revisionKeys:[state.articleRevisionKey,...state.attachments.map(a=>a.revisionKey)]}});
  }catch(error){signal?.throwIfAborted();items.push(rejected(original,error.message||'evidence-unavailable'));}
 }
 return {...maritime,items};
}
