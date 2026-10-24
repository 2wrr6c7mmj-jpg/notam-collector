import type {SourceRecord} from './nav-store';
import type {Notice} from './notam';

// Only witnessed work is counted. A missing collector ledger stays unknown,
// rather than advertising zero backlog or complete geographical coverage.
export type NavCollectionProgress = {
 schemaVersion:1; scope:'observed-only'; pendingBodies:number|null; retryBodies:number|null;
 deferredBodies:number|null; hasMoreListingPages:boolean|null; savedRecords:number;
 delta:{added:number;revised:number}|null; deltaAt:number|null;
};
type ProgressRecord=SourceRecord&{
 firstPage?:{entries?:{status:string;url:string}[];priorEntries?:{status:string;url:string}[]};
 navareaPending?:string[];navareaRetry?:string[];navareaDeferred?:string[];
};
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const urls=(values:unknown)=>Array.isArray(values)?new Set(values.filter((x):x is string=>typeof x==='string')):null;
export function collectionProgress(record:SourceRecord):NavCollectionProgress {
 const r=record as ProgressRecord,old=record.status.collectionProgress;
 let pending=urls(r.pendingArticles),retry=urls(r.retryArticles),deferred:number|null=null,hasMore:boolean|null=null;
 if(r.firstPage){
  pending=urls([...(r.pendingArticles||[]),...(r.firstPage.entries||[]).filter(e=>e.status==='pending').map(e=>e.url)]);
  retry=urls([...(r.retryArticles||[]),...(r.firstPage.entries||[]).filter(e=>e.status==='failed').map(e=>e.url)]);
  const collection=(record.status as unknown as {collection?:{deferredHistoryRows?:unknown}}).collection;
  deferred=count(collection?.deferredHistoryRows);
 }else if(r.status.parser==='navarea-public'){
  pending=urls(r.navareaPending);retry=urls(r.navareaRetry);deferred=urls(r.navareaDeferred)?.size??null;
 }else if(r.status.parser==='jcg-navarea11'){
  try{const c=JSON.parse(r.continuation||'null');if(Array.isArray(c?.years)&&Number.isInteger(c.cursor))hasMore=c.cursor<c.years.length;}catch{/* Unknown historical cursor is not complete. */}
 }else if(!r.status.parser){hasMore=!!r.continuation;}
 if(pending&&retry)for(const url of retry)pending.delete(url);
 const validDelta=old?.schemaVersion===1&&old.scope==='observed-only'&&old.delta&&count(old.delta.added)!==null&&count(old.delta.revised)!==null;
 return {schemaVersion:1,scope:'observed-only',pendingBodies:pending?.size??null,retryBodies:retry?.size??null,deferredBodies:deferred,hasMoreListingPages:hasMore,savedRecords:record.items.length,delta:validDelta?{added:old.delta!.added,revised:old.delta!.revised}:null,deltaAt:validDelta&&typeof old.deltaAt==='number'&&Number.isSafeInteger(old.deltaAt)&&old.deltaAt>=0?old.deltaAt:null};
}
function sourceVersion(notice:Notice):string {
 const n=notice as Notice&{taiwan?:{documents?:{url?:string;sha256?:string}[]};navareaEvidence?:{contentVersion?:string};chinaFirstPage?:{originals?:unknown[]}};
 if(n.navareaEvidence?.contentVersion)return n.navareaEvidence.contentVersion;
 // Changes to fetch-failure explanations or derived geometry are not source revisions.
 if(n.taiwan)return JSON.stringify(n.taiwan.documents?.map(d=>[d.url,d.sha256])||[]);
 return JSON.stringify([n.text,n.chinaFirstPage?.originals]);
}
export function withCollectionProgress<T extends SourceRecord>(previous:SourceRecord,next:T,at:number):T {
 const key=(n:Notice)=>JSON.stringify([n.id,n.sourceUrl]),old=new Map(previous.items.map(n=>[key(n),sourceVersion(n)]));
 let added=0,revised=0;
 for(const n of next.items){const prior=old.get(key(n));if(prior===undefined)added++;else if(prior!==sourceVersion(n))revised++;}
 const result={...next,status:{...next.status,collectionProgress:{...collectionProgress(next),delta:{added,revised},deltaAt:at}}};
 // Optional diagnostics must never make an otherwise persistable bounded source
 // exceed the established private-record envelope. Existing source data wins.
 return new TextEncoder().encode(JSON.stringify(result)).length<=1_800_000?result:next;
}
