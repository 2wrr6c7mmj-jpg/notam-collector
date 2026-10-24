// Application ceilings for newly introduced maritime collection. These are
// deliberately independent of billing-plan claims and cannot bypass source gates.
export const NAV_COLLECTION_WINDOW_MS = 2 * 60 * 60 * 1000;
export const NAV_COLLECTION_LIMITS = {requests:1600,bytes:400*1024*1024,invocationRequests:48};
export const NAV_COLLECTION_GROUPS = {
 chinaCentral:{requests:1536,bytes:384*1024*1024},
 chinaSupplemental:{requests:32,bytes:4*1024*1024},
 taiwan:{requests:16,bytes:8*1024*1024},
 navarea:{requests:16,bytes:4*1024*1024},
} as const;
export type NavCollectionGroup = keyof typeof NAV_COLLECTION_GROUPS;
export type NavRequestKind = 'listing'|'body';
export type NavInvocationBudget = {used:number;limit:number;pendingListings:number};
export type NavRequestBudget = {bodyRequests:number;reserve:(kind:NavRequestKind,maxBytes:number)=>Promise<number>;finish:()=>void};
export function maritimeInvocationBudget(pendingListings=2):NavInvocationBudget {
 return {used:0,limit:NAV_COLLECTION_LIMITS.invocationRequests,pendingListings};
}
const BUDGET_KEY='nav-new-collection:budget:v1';
const SOURCE_PREFIX='nav-new-collection:admission:v1:';
export class MaritimeBudgetDeferred extends Error {
 constructor(message='Maritime collection budget deferred; saved originals retained'){super(message);this.name='MaritimeBudgetDeferred';}
}
export async function admitMaritimeCollection(db:D1Database,sourceId:string,group:NavCollectionGroup,invocation=maritimeInvocationBudget(),now=Date.now(),incompleteChina=false):Promise<{admitted:false;nextAllowedAt:number}|{admitted:true;budget:NavRequestBudget}> {
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(sourceId)||!Object.hasOwn(NAV_COLLECTION_GROUPS,group))throw new MaritimeBudgetDeferred('Invalid collection budget scope');
 const key=SOURCE_PREFIX+group+':'+sourceId;
 const interval=group==='chinaCentral'&&incompleteChina?15*60*1000:NAV_COLLECTION_WINDOW_MS;
 // Durable spacing: complete sources retain two hours; unfinished China work
 // may retry after fifteen minutes, within the same atomic global envelope.
 const admission=await db.prepare(`INSERT INTO reference_cache(id,data,checked_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at WHERE reference_cache.checked_at>=0 AND reference_cache.checked_at<=? AND json_valid(reference_cache.data) AND json_extract(reference_cache.data,'$.schemaVersion')=1 AND json_extract(reference_cache.data,'$.group')=? AND json_extract(reference_cache.data,'$.sourceId')=? AND json_extract(reference_cache.data,'$.lastStartedAt')=reference_cache.checked_at`)
  .bind(key,JSON.stringify({schemaVersion:1,group,sourceId,lastStartedAt:now}),now,now-interval,group,sourceId).run();
 if(!admission.meta.changes){
  const rows=await db.prepare('SELECT checked_at FROM reference_cache WHERE id=?').bind(key).all<{checked_at:number}>();
  const prior=rows.results[0]?.checked_at;return {admitted:false,nextAllowedAt:Number.isFinite(prior)&&prior>=0&&prior+interval>now?prior+interval:now+interval};
 }
 let listingsLeft=2,bodiesLeft=group==='chinaCentral'?46:16,finished=false;
 const finish=()=>{if(!finished){invocation.pendingListings=Math.max(0,invocation.pendingListings-listingsLeft);listingsLeft=0;finished=true;}};
 const reserve=async(kind:NavRequestKind,maxBytes:number)=>{
  if(finished)throw new MaritimeBudgetDeferred('Collection admission already closed');
  if(!Number.isInteger(maxBytes)||maxBytes<=0)throw new MaritimeBudgetDeferred('Invalid response byte reservation');
  if(kind==='listing'&&listingsLeft<=0||kind==='body'&&bodiesLeft<=0)throw new MaritimeBudgetDeferred('Per-source request share deferred');
  if(invocation.used>=invocation.limit||kind==='body'&&invocation.used+invocation.pendingListings>=invocation.limit)throw new MaritimeBudgetDeferred('Invocation request budget reserved for remaining listings');
  // Reserve a worst-case response before network I/O. Failed/304/oversized
  // responses keep their reservation; refunds could permit uncertain retries.
  const bytes=group==='chinaCentral'?Math.min(maxBytes,256*1024):maxBytes;
  const limits=NAV_COLLECTION_GROUPS[group];
  if(bytes>limits.bytes||bytes>NAV_COLLECTION_LIMITS.bytes)throw new MaritimeBudgetDeferred('Response exceeds the group byte envelope');
  const slot=Math.floor(Date.now()/NAV_COLLECTION_WINDOW_MS);
  const initial=JSON.stringify({schemaVersion:1,slot,requests:1,bytes,groups:{[group]:{requests:1,bytes}}});
  const requestPath=`$.groups.${group}.requests`,bytePath=`$.groups.${group}.bytes`;
  // The single UPDATE predicate and increment are atomic in SQLite/D1. A stale
  // clock cannot reset a newer slot. Invalid persisted JSON fails closed.
  const sql=`INSERT INTO reference_cache(id,data,checked_at) VALUES(?,?,?)
   ON CONFLICT(id) DO UPDATE SET data=CASE WHEN json_extract(reference_cache.data,'$.slot')<? THEN excluded.data ELSE
    json_set(reference_cache.data,'$.requests',json_extract(reference_cache.data,'$.requests')+1,'$.bytes',CAST(json_extract(reference_cache.data,'$.bytes')+? AS INTEGER),
     ?,coalesce(json_extract(reference_cache.data,?),0)+1,?,CAST(coalesce(json_extract(reference_cache.data,?),0)+? AS INTEGER)) END,checked_at=excluded.checked_at
   WHERE json_type(reference_cache.data,'$.schemaVersion')='integer' AND json_extract(reference_cache.data,'$.schemaVersion')=1
    AND json_type(reference_cache.data,'$.slot')='integer' AND json_extract(reference_cache.data,'$.slot')>=0
    AND json_type(reference_cache.data,'$.requests')='integer' AND json_extract(reference_cache.data,'$.requests') BETWEEN 0 AND ${NAV_COLLECTION_LIMITS.requests}
    AND json_type(reference_cache.data,'$.bytes')='integer' AND json_extract(reference_cache.data,'$.bytes') BETWEEN 0 AND ${NAV_COLLECTION_LIMITS.bytes}
    AND json_type(reference_cache.data,'$.groups')='object'
    AND NOT EXISTS(SELECT 1 FROM json_each(reference_cache.data,'$.groups') AS g WHERE g.key NOT IN ('chinaCentral','chinaSupplemental','taiwan','navarea')
      OR json_type(g.value)!='object' OR coalesce(json_type(g.value,'$.requests'),'missing')!='integer' OR coalesce(json_type(g.value,'$.bytes'),'missing')!='integer'
      OR json_extract(g.value,'$.requests') NOT BETWEEN 0 AND CASE g.key WHEN 'chinaCentral' THEN ${NAV_COLLECTION_GROUPS.chinaCentral.requests} WHEN 'chinaSupplemental' THEN 32 ELSE 16 END
      OR json_extract(g.value,'$.bytes') NOT BETWEEN 0 AND CASE g.key WHEN 'chinaCentral' THEN ${NAV_COLLECTION_GROUPS.chinaCentral.bytes} WHEN 'chinaSupplemental' THEN 4194304 WHEN 'taiwan' THEN 8388608 ELSE 4194304 END)
    AND json_extract(reference_cache.data,'$.requests')=coalesce((SELECT sum(json_extract(g.value,'$.requests')) FROM json_each(reference_cache.data,'$.groups') AS g),0)
    AND json_extract(reference_cache.data,'$.bytes')=coalesce((SELECT sum(json_extract(g.value,'$.bytes')) FROM json_each(reference_cache.data,'$.groups') AS g),0)
    AND (json_extract(reference_cache.data,'$.slot')<? OR (json_extract(reference_cache.data,'$.slot')=?
    AND json_extract(reference_cache.data,'$.requests')<? AND json_extract(reference_cache.data,'$.bytes')+?<=?
    AND coalesce(json_extract(reference_cache.data,?),0)<? AND coalesce(json_extract(reference_cache.data,?),0)+?<=?))`;
  // Claim the in-process slot before await, so parallel bodies cannot overspend.
  invocation.used++;if(kind==='listing'){listingsLeft--;invocation.pendingListings=Math.max(0,invocation.pendingListings-1);}else bodiesLeft--;
  let result;
  try{result=await db.prepare(sql).bind(BUDGET_KEY,initial,Date.now(),slot,bytes,requestPath,requestPath,bytePath,bytePath,bytes,slot,slot,NAV_COLLECTION_LIMITS.requests,bytes,NAV_COLLECTION_LIMITS.bytes,requestPath,limits.requests,bytePath,bytes,limits.bytes).run();}
  catch{throw new MaritimeBudgetDeferred('Persistent budget could not be verified');}
  if(!result.meta.changes)throw new MaritimeBudgetDeferred('Two-hour global request or byte ceiling reached');
  return bytes;
 };
 return {admitted:true,budget:{bodyRequests:group==='chinaCentral'?46:16,reserve,finish}};
}
