import type {SourceRecord} from './nav-store';
import {NAVAREA_COMPRESSED_PREFIX,isNavareaStorageId,encodeNavareaStorage,decodeNavareaStorage} from './navarea-storage-codec';

// Source versions with private full bodies never overwrite the rows read by an
// older release. Activation/read projection is owned by the reviewed registry.
export const PRIVATE_NAV_PREFIX='nav-reviewed-source:v1:';
export const PRIVATE_NAV_IDS=new Set(['tw-fisheries','tw-moa-ship','tw-motc','tw-mnd-navigation','tw-mnd-firing','navarea-x','navarea-xiv','navarea-ix']);
export const PRIVATE_NAV_MAX_BYTES=1_800_000;
const validTime=(value:unknown)=>value===undefined||value===null||typeof value==='number'&&Number.isSafeInteger(value)&&Math.abs(value)<=8640000000000000;
function validRecord(value:unknown,id:string):value is SourceRecord {
 if(!value||typeof value!=='object')return false;
 const r=value as SourceRecord;
 if(r.status?.id!==id||!Array.isArray(r.items)||!['pending','ok','partial','error'].includes(r.status.state))return false;
 return r.items.every(n=>n&&typeof n.id==='string'&&typeof n.text==='string'&&validTime(n.issued)&&validTime(n.start)&&validTime(n.end)&&(n.validityPeriods===undefined||Array.isArray(n.validityPeriods)&&n.validityPeriods.every(p=>p&&typeof p.start==='number'&&typeof p.end==='number'&&validTime(p.start)&&validTime(p.end)&&p.end>p.start))&&Array.isArray(n.shapes)&&n.shapes.every(s=>s&&['point','line','polygon','circle'].includes(s.kind)&&Array.isArray(s.points)&&s.points.length>0&&s.points.every(p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180))&&Array.isArray(n.warnings)&&n.warnings.every(w=>typeof w==='string'));
}
export async function readPrivateNavSources(db:D1Database,activeIds:readonly string[]):Promise<{records:SourceRecord[];errors:string[]}> {
 const ids=[...new Set(activeIds.filter(id=>PRIVATE_NAV_IDS.has(id)))];if(!ids.length)return {records:[],errors:[]};
 const keys=ids.flatMap(id=>[PRIVATE_NAV_PREFIX+id,...(isNavareaStorageId(id)?[NAVAREA_COMPRESSED_PREFIX+id]:[])]);
 let rows:{results:{id:string;data:string}[]};
 try{rows=await db.prepare(`SELECT id,data FROM reference_cache WHERE id IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{id:string;data:string}>();}
 catch{return {records:[],errors:ids};}
 const records:SourceRecord[]=[],errors:string[]=[];
 for(const id of ids){
  // A corrupt current row is an error, never silently reported as the older
  // rollback snapshot. The original v1 row is left byte-for-byte intact.
  const compressed=isNavareaStorageId(id)?rows.results.find(r=>r.id===NAVAREA_COMPRESSED_PREFIX+id):undefined;
  const row=compressed||rows.results.find(r=>r.id===PRIVATE_NAV_PREFIX+id);if(!row)continue;
  try{if(new TextEncoder().encode(row.data).length>PRIVATE_NAV_MAX_BYTES)throw Error('Invalid private source size');const record:unknown=compressed?await decodeNavareaStorage(row.data):JSON.parse(row.data);if(!validRecord(record,id))throw Error('Invalid private source record');records.push(record);}
  catch{errors.push(id);}
 }
 return {records,errors};
}
export async function writePrivateNavSource(db:D1Database,record:SourceRecord,lease:{id:string;startedAt:number},serialize:(record:SourceRecord)=>string=JSON.stringify):Promise<void> {
 const id=record.status.id;
 if(!PRIVATE_NAV_IDS.has(id)||lease.id!=='nav:'+id||!validRecord(record,id))throw Error('Private source owner/schema mismatch');
 const prepared=serialize(record),checked:unknown=JSON.parse(prepared);if(!validRecord(checked,id))throw Error('Serialized private source schema mismatch');
 const compressed=isNavareaStorageId(id),serialized=compressed?encodeNavareaStorage(checked):prepared;
 if(new TextEncoder().encode(serialized).length>PRIVATE_NAV_MAX_BYTES)throw Error('Private source capacity reached; previous originals retained');
 const persisted:unknown=compressed?await decodeNavareaStorage(serialized):JSON.parse(serialized);if(!validRecord(persisted,id)||JSON.stringify(persisted)!==JSON.stringify(checked))throw Error('Serialized private source schema mismatch');
 const result=await db.prepare('INSERT INTO reference_cache(id,data,checked_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM nav_refresh WHERE id=? AND started_at=? AND lease_until>?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at').bind((compressed?NAVAREA_COMPRESSED_PREFIX:PRIVATE_NAV_PREFIX)+id,serialized,Date.now(),lease.id,lease.startedAt,Date.now()).run();
 if(!result.meta.changes)throw Error('Private source lease expired; previous originals retained');
}
