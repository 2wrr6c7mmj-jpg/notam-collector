/** Fixed public release input for UI only. Never calls a collector or writes D1. */
export const MSIL_PUBLIC_ORIGIN='https://notam-watch.pages.dev';
export const MSIL_PUBLIC_MAX_AGE=8*3600000;
export type MsilReadStage='INIT'|'DEADLINE'|'CALLER_ABORT'|'VERIFY_MAIN'|'VERIFY_MANIFEST'|'VERIFY_BODY'|'VERIFY_ITEMS'|'VERIFY_RELEASE'|'DONE'|`${'MAIN'|'MANIFEST'|'BODY'|'RECHECK'}_${'FETCH'|'HTTP'|'READ'|'JSON'}`;
const aborted=(signal:AbortSignal)=>{if(signal.aborted)throw new Error('MSIL public read aborted');};
const MAX_BYTES=6*1024*1024,MANIFEST_BYTES=16*1024;
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const requireValue=(v:unknown,why:string)=>{if(!v)throw Error('MSIL public evidence: '+why);};
const digest=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const time=(s:unknown)=>typeof s==='string'?Date.parse(s):NaN;
async function read(path:string,max:number,fetcher:typeof fetch,signal:AbortSignal,part:'MAIN'|'MANIFEST'|'BODY'|'RECHECK',stage:(value:MsilReadStage)=>void){
 const url=MSIL_PUBLIC_ORIGIN+path;
 stage(`${part}_FETCH`);aborted(signal);
 // Server-only fetch: construct fresh fixed headers; never copy incoming cookies/auth.
 const r=await fetcher(url,{method:'GET',redirect:'error',signal,headers:{Accept:'application/json','Cache-Control':'no-cache'}});
 stage(`${part}_HTTP`);
 requireValue(r.ok&&!r.redirected&&(!r.url||r.url===url),'response');requireValue(/application\/json/i.test(r.headers.get('content-type')||''),'content type');
 const declared=r.headers.get('content-length');if(declared)requireValue(/^\d+$/.test(declared)&&Number(declared)<=max,'response size');
 stage(`${part}_READ`);
 const reader=r.body?.getReader();requireValue(reader,'missing body');const chunks:Uint8Array[]=[];let size=0;
 const abort=()=>{void reader!.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){aborted(signal);const part=await reader!.read();aborted(signal);if(part.done)break;size+=part.value.byteLength;requireValue(size<=max,'response size');chunks.push(part.value);}}
 finally{signal.removeEventListener('abort',abort);await reader!.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 if(declared&&!r.headers.get('content-encoding'))requireValue(Number(declared)===size,'truncated response');
 stage(`${part}_JSON`);
 return {bytes,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
}
const validPeriod=(p:Record<string,unknown>)=>p&&Number.isFinite(p.start)&&Number.isFinite(p.end)&&(p.end as number)>(p.start as number);
const safeLink=(s:unknown)=>{try{const u=new URL(String(s));return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export async function readPublicMsil({fetcher=fetch,signal,now=Date.now(),onStage=()=>{},timeoutMs=25000}:{fetcher?:typeof fetch;signal?:AbortSignal;now?:number;onStage?:(stage:MsilReadStage)=>void;timeoutMs?:number}={}){
 let stopped:'DEADLINE'|'CALLER_ABORT'|null=null;
 const stage=(value:MsilReadStage)=>{if(!stopped||value===stopped)onStage(value);};
 stage('INIT');requireValue(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=25000,'deadline');
 const controller=new AbortController(),bounded=controller.signal;
 const stop=()=>{if(!stopped){stopped='CALLER_ABORT';stage('CALLER_ABORT');}controller.abort();};
 if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
 const timer=setTimeout(()=>{if(!stopped){stopped='DEADLINE';stage('DEADLINE');}controller.abort();},timeoutMs);
 try{
 const main=(await read('/data/manifest.json',MANIFEST_BYTES,fetcher,bounded,'MAIN',stage)).value;
 stage('VERIFY_MAIN');
 requireValue(main.schemaVersion===1&&hash(main.sha256),'main manifest');
 const m=(await read('/data/msil-manifest.json',MANIFEST_BYTES,fetcher,bounded,'MANIFEST',stage)).value;
 stage('VERIFY_MANIFEST');
 requireValue(m.schemaVersion===1&&m.kind==='msil-ui-manifest'&&hash(m.sha256)&&m.file===`msil-${m.sha256.slice(0,16)}.json`,'sidecar manifest');
 requireValue(Number.isSafeInteger(m.bytes)&&m.bytes>0&&m.bytes<=MAX_BYTES&&Number.isSafeInteger(m.count)&&m.count>0&&m.count<=10000,'manifest bounds');
 requireValue(m.snapshotSha256===main.sha256&&m.buildAt===main.buildAt,'snapshot binding');
 const sourceTime=time(m.sourceCompletedAt),built=time(m.buildAt);
 requireValue(Number.isFinite(sourceTime)&&sourceTime<=now&&now-sourceTime<=MSIL_PUBLIC_MAX_AGE&&Number.isFinite(built)&&built>=sourceTime&&built<=now,'source freshness');
 const {bytes,value:b}=await read('/data/'+m.file,MAX_BYTES,fetcher,bounded,'BODY',stage);
 stage('VERIFY_BODY');
 requireValue(bytes.length===m.bytes&&await digest(bytes)===m.sha256,'body hash');aborted(bounded);
 requireValue(b.schemaVersion===1&&b.kind==='msil-ui-projection'&&['buildAt','snapshotSha256','sourceCompletedAt','count'].every(k=>b[k]===m[k]),'body binding');
 requireValue(b.acquisition?.transportComplete===true&&b.acquisition.consistentSnapshot===false&&b.acquisition.fullWarningCoverage===false&&b.acquisition.completedAt===m.sourceCompletedAt&&['ok','error'].includes(b.refreshState),'acquisition');
 requireValue(Array.isArray(b.items)&&b.items.length===m.count&&Array.isArray(b.originalHashes)&&b.originalHashes.length===m.count,'all records');
 const hashes=new Map<string,string>();for(const h of b.originalHashes){requireValue(typeof h.identity==='string'&&!hashes.has(h.identity)&&hash(h.textSha256),'original identity');hashes.set(h.identity,h.textSha256);}
 stage('VERIFY_ITEMS');
 const ids=new Set<string>();
 for(const n of b.items){
  aborted(bounded);
  requireValue(typeof n.msilIdentity==='string'&&!ids.has(n.msilIdentity)&&hashes.has(n.msilIdentity)&&n.id===n.msilIdentity&&n.dataset==='maritime'&&n.sourceCountry==='JP','item identity');ids.add(n.msilIdentity);
  requireValue(typeof n.text==='string'&&Array.isArray(n.originals)&&n.originals.length===1&&n.originals[0].text===n.text&&await digest(new TextEncoder().encode(n.text))===hashes.get(n.msilIdentity),'original hash');
  requireValue(Array.isArray(n.sourceLinks)&&n.sourceLinks.length>0&&n.sourceLinks.every(safeLink)&&n.originals[0].sourceLinks?.every(safeLink)&&safeLink(n.sourceUrl),'source links');
  requireValue(Array.isArray(n.shapes)&&n.shapes.every((s:Record<string,unknown>)=>['point','line','polygon','circle'].includes(String(s.kind))&&Array.isArray(s.points)&&s.points.length>0&&s.points.every((p:unknown)=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Math.abs(p[0])<=90&&Number.isFinite(p[1])&&Math.abs(p[1])<=180)&&(s.kind!=='circle'||Number.isFinite(s.radius)&&(s.radius as number)>0)&&(s.sourceIndex===undefined||s.sourceIndex===0)),'geometry');
  const s=n.staticSchedule;requireValue(s&&Array.isArray(s.periods)&&s.periods.every(validPeriod)&&(!s.validityPeriods||Array.isArray(s.validityPeriods)&&s.validityPeriods.every(validPeriod))&&(!s.openEndedPeriods||Array.isArray(s.openEndedPeriods)&&s.openEndedPeriods.every((p:Record<string,unknown>)=>Number.isFinite(p.start)&&p.end===null)),'schedule');
  requireValue(Array.isArray(n.warnings)&&typeof n.cancelled==='boolean'&&n.detail&&typeof n.detail.label==='string'&&Array.isArray(n.detail.details)&&n.detail.details.every((x:unknown)=>typeof x==='string')&&typeof b.attribution==='string'&&safeLink(b.constraintsUrl),'display evidence');
 }
 const end=(await read('/data/manifest.json',MANIFEST_BYTES,fetcher,bounded,'RECHECK',stage)).value;
 stage('VERIFY_RELEASE');
 requireValue(end.sha256===main.sha256&&end.buildAt===main.buildAt,'release changed');aborted(bounded);
 stage('DONE');
 return {...b,publicEvidence:{origin:MSIL_PUBLIC_ORIGIN,sha256:m.sha256,snapshotSha256:m.snapshotSha256,verifiedAt:now,sourceCompletedAt:m.sourceCompletedAt}};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
