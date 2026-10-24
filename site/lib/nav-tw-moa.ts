import type { Notice } from './notam';
import type { NavSource } from './nav-sources';
import type { SourceRecord } from './nav-store';
import { twDay, twGet, twPriorBackoff, twStopEvidence, type TwBackoff, twBoundBudget, twOfficialUrl, twSha256, type TwNotice, type TwReceipt, type TwRequestBudget } from './nav-tw-evidence';

export const twMoaSource: NavSource = {
  id:'tw-moa-ship', name:'台湾農業部 航船布告JSON（補助）', region:'台湾周辺（漁業署掲載の航船布告）', country:'TW', parser:'tw-moa-ship',
  url:'https://data.moa.gov.tw/Service/OpenData/FromM/BoatBulletinData.aspx',
};
const LICENSE = 'https://data.gov.tw/license';
const jsonBody=(text:string)=>text.charCodeAt(0)===0xFEFF?text.slice(1):text;
const rawRowId=async(row:Record<string,unknown>)=>'TW-MOA-'+(await twSha256(new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])))))).slice(0,24);

export async function parseTwMoaJson(text: string): Promise<TwNotice[]> {
  const rows: unknown = JSON.parse(jsonBody(text));
  if (!Array.isArray(rows) || !rows.length || rows.length > 20_000) throw new Error('農業部JSONが空または未対応形式です');
  const items: TwNotice[] = [], seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('農業部JSONレコード形式');
    const r = row as Record<string,unknown>;
    if (typeof r['項目'] !== 'string' || !r['項目'].trim() || !('日期' in r) || !('網址' in r) || ![r['日期'], r['網址']].every(v=>typeof v==='string'||v===null)) throw new Error('農業部JSON必須項目の形式');
    const title = r['項目'].trim(), rawDate = (r['日期'] as string|null)||'', day = twDay(rawDate);
    const rawUrls = ((r['網址'] as string|null)||'').split(/,\s*(?=https?:\/\/)/).map(s=>s.trim()).filter(Boolean), urls: string[] = [];
    const unresolved = ['添付資料の全文・時間・区域は未解析です。'];
    if (!day) unresolved.push(rawDate ? `掲載日が不正です：${rawDate}` : '掲載日は未記載です。');
    for (const raw of rawUrls) {
      try { urls.push(twOfficialUrl(raw,['www.fa.gov.tw'])); }
      catch { unresolved.push(`公式添付URLを確認できません：${raw}`); }
    }
    if (!urls.length) unresolved.push('添付先が未記載、または公式URLを確認できません。');
    // All source fields enter the fingerprint. Changes create a preserved version,
    // rather than silently replacing an unrelated record with the same title.
    const id=await rawRowId(r);
    if (seen.has(id)) continue; seen.add(id);
    items.push({ id, location:title, text:`${title}\n掲載日（日期）: ${rawDate || '未記載'}\n原文添付リンク:\n${rawUrls.join('\n')}`, issued:null, start:null, end:null, permanent:false,
      purpose:/射擊|射撃|實彈|軍事|操演|飛彈|火箭/.test(title)?'firing':'other', shapes:[], validityPeriods:[], timeUncertain:true,
      sourceCountry:'TW', sourceName:twMoaSource.name, sourceUrl:urls[0]||twMoaSource.url,
      warnings:['JSON掲載日は日付精度です。発表時刻・活動開始時刻には転用していません。','農業部に掲載された航船布告の補助情報です。台湾全域・国防部全件のミラーではありません。',...unresolved],
      taiwan:{ version:2,publisher:'MOA',role:'supplement',publication:day?{value:day,precision:'day',evidence:`日期: ${rawDate}`}:undefined,
        documents:[],attachments:[...new Set(urls)].map(url=>({url,state:'pending'})),bodyComplete:false,semanticComplete:false,
        rights:{status:'metadata-open',url:LICENSE,detail:'政府資料開放授權條款第1版のデータセット。リンク先の第三者添付資料は別途確認。'},unresolved },
    });
  }
  return items;
}
export async function collectTwMoaSource(source: NavSource, previous: SourceRecord, fetcher: typeof fetch = fetch,budget?:TwRequestBudget): Promise<SourceRecord> {
  const backoff=twPriorBackoff(previous as SourceRecord&{taiwanBackoff?:TwBackoff});if(backoff)return {...previous,status:{...previous.status,detail:`発表元の再試行待機中（${new Date(backoff.until).toISOString()}まで）。保存データを保持。`}};
  const checkedAt = Date.now();
  try {
    const response = await twGet(source.url,['data.moa.gov.tw'],fetcher,checkedAt+15_000,1024*1024,twBoundBudget(budget,1),'listing');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(response.bytes),rawCount=(JSON.parse(jsonBody(text)) as unknown[]).length;
    const current=await parseTwMoaJson(text);
    const archives=await retainMoaRows(previous as TwMoaRecord,current,checkedAt);
    const items=await mergeMoaArchives(current,archives);
    response.receipt.extraction='complete';
    // Dataset receipt belongs to the source, not duplicated 1,990 times.
    const days = current.flatMap(n=>n.taiwan?.publication?[n.taiwan.publication.value]:[]).sort();
    const result={items, revision:2, taiwanDatasetJson:text,taiwanDatasetReceipt:response.receipt,taiwanArchivedRows:archives,taiwanDatasetQuality:{rawCount,uniqueCount:current.length,exactDuplicates:rawCount-current.length,archivedCount:items.length-current.length}, status:{...source,state:'partial',checkedAt,fetchedAt:checkedAt,count:items.length,pages:1,detail:`公式JSON ${rawCount}行、完全重複を除く現行${current.length}件、前回掲載の保存${items.length-current.length}件。最新掲載日=${days.at(-1)||'未確認'}。添付本文は未解析。公開日を活動期間にしていません。国防部全件の代替ではありません。`}} as TwMoaRecord;
    serializeTwRecord(result); // Capacity is checked before the caller can mutate storage.
    return result;
  } catch (error) {
    return {...previous,...(twStopEvidence(error)?{taiwanBackoff:twStopEvidence(error)}:{}),status:{...previous.status,...source,state:'error',checkedAt,count:previous.items.length,pages:0,detail:`${error instanceof Error?error.message:'農業部JSON取得失敗'}。警告0件とは確認できません。保存分を保持。`}};
  }
}

export type TwMoaArchive={id:string;row?:Record<string,unknown>;retainedNotice?:Notice;archivedAt:number;sha256:string};
export type TwMoaRecord = SourceRecord & {taiwanDatasetJson?:string;taiwanDatasetReceipt?:TwReceipt;taiwanArchivedRows?:TwMoaArchive[]};
// The API is a compact index (about 625 kB) whereas repeating normalized warning
// metadata exceeds D1's per-value size. Persist exact source JSON once and derive
// the same notices when reading. No rows are silently trimmed by publication age.
export function serializeTwRecord(record:SourceRecord):string {
  const moa=record as TwMoaRecord;
  const persisted=record.status.id==='tw-moa-ship'&&moa.taiwanDatasetJson?{...record,items:[]}:record;
  const value=JSON.stringify(persisted);
  if(new TextEncoder().encode(value).length>1_800_000)throw new Error('台湾保存容量上限。既存の保存データを保持し、完全取得とは表示しません');
  return value;
}
export async function restoreTwMoaRecord(record:SourceRecord):Promise<SourceRecord>{
  const moa=record as TwMoaRecord;
  if(record.status.id!=='tw-moa-ship'||!moa.taiwanDatasetJson)return record;
  try{
    await verifyMoaDataset(moa);
    return {...record,items:await mergeMoaArchives(await parseTwMoaJson(moa.taiwanDatasetJson),moa.taiwanArchivedRows||[])};}
  catch(error){return {...record,status:{...record.status,state:'error',detail:`保存JSONの復元失敗：${error instanceof Error?error.message:'不明'}。警告0件とは確認できません。`}};}
}

async function verifyMoaDataset(record:TwMoaRecord):Promise<void>{
 const bytes=new TextEncoder().encode(record.taiwanDatasetJson||'');
 if(!record.taiwanDatasetReceipt||bytes.byteLength!==record.taiwanDatasetReceipt.bytes||await twSha256(bytes)!==record.taiwanDatasetReceipt.sha256)throw new Error('取得証跡と保存JSONのSHA-256が一致しません');
}
const archiveHash=(entry:Omit<TwMoaArchive,'sha256'>)=>twSha256(new TextEncoder().encode(JSON.stringify(entry)));
async function validateArchive(entry:TwMoaArchive):Promise<void>{
 if(!entry||typeof entry!=='object'||!/^TW-MOA-[a-f0-9]{24}$/.test(entry.id)||!Number.isSafeInteger(entry.archivedAt)||entry.archivedAt<0)throw new Error('農業部の保存履歴が不正です');
 const {sha256,...body}=entry;
 if(await archiveHash(body)!==sha256||!entry.row&&!entry.retainedNotice||entry.retainedNotice&&entry.retainedNotice.id!==entry.id)throw new Error('農業部の保存履歴SHA-256が一致しません');
 if(entry.row&&await rawRowId(entry.row)!==entry.id)throw new Error('農業部の保存履歴IDが一致しません');
}
function importantNotice(n:Notice,now:number){return !!n.cancelled||!!n.permanent||n.end!==null&&Number.isFinite(n.end)&&n.end>now||(n.validityPeriods||[]).some(p=>Number.isFinite(p.end)&&p.end>now)||n.shapes?.length>0;}
async function retainMoaRows(previous:TwMoaRecord,current:TwNotice[],now:number):Promise<TwMoaArchive[]>{
 const archive=new Map<string,TwMoaArchive>();
 if(previous.taiwanArchivedRows!==undefined&&!Array.isArray(previous.taiwanArchivedRows))throw new Error('農業部の保存履歴形式');
 for(const entry of previous.taiwanArchivedRows||[]){await validateArchive(entry);archive.set(entry.id,entry);}
 const ids=new Set(current.map(n=>n.id)),oldItems=new Map(previous.items.map(n=>[n.id,n]));
 const rows=new Map<string,Record<string,unknown>>();
 if(previous.taiwanDatasetJson){await verifyMoaDataset(previous);for(const row of JSON.parse(jsonBody(previous.taiwanDatasetJson)) as Record<string,unknown>[])rows.set(await rawRowId(row),row);}
 for(const [id,row]of rows){const n=oldItems.get(id);if(ids.has(id)&&(!n||!importantNotice(n,now)))continue;
  const body={id,row,...(n&&importantNotice(n,now)?{retainedNotice:n}:{}),archivedAt:archive.get(id)?.archivedAt||now};archive.set(id,{...body,sha256:await archiveHash(body)});
 }
 // Older normalized-only cache entries are kept intact when no source row exists.
 for(const n of previous.items){if(rows.has(n.id)||ids.has(n.id)&&!importantNotice(n,now))continue;
  const body={id:n.id,retainedNotice:n,archivedAt:archive.get(n.id)?.archivedAt||now};archive.set(n.id,{...body,sha256:await archiveHash(body)});
 }
 return [...archive.values()];
}
async function mergeMoaArchives(current:TwNotice[],archives:TwMoaArchive[]):Promise<Notice[]>{
 if(!Array.isArray(archives)||archives.length>20_000)throw new Error('農業部の保存履歴上限または形式');
 const result=new Map<string,Notice>(current.map(n=>[n.id,n]));
 for(const entry of archives){await validateArchive(entry);const existing=result.get(entry.id);
  const archived=entry.retainedNotice||(entry.row?(await parseTwMoaJson(JSON.stringify([entry.row])))[0]:undefined);
  if(!archived)throw new Error('農業部の保存履歴を復元できません');
  if(existing&&!entry.retainedNotice)continue;
  result.set(entry.id,{...(existing||archived),...archived,warnings:[...new Set([...archived.warnings,...(!existing?['現行JSONに見当たらない以前の掲載情報です。消失を活動取消とは断定していません。']:[])])]});
 }
 return [...result.values()];
}
