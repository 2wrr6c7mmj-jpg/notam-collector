import {validateTaiwanEvidence,completeTaiwanEvidence,validTaiwanInterpretation,validTaiwanPeriods,validTaiwanShape} from './nav-tw-contract.mjs';
import type { Notice, Shape } from './notam';

export type TwReceipt = {
  url: string; requestedUrl?: string; fetchedAt: number; status: number; bytes: number; sha256: string;
  mediaType: string; etag?: string; lastModified?: string;
  extraction: 'complete' | 'unsupported' | 'unread'; reason?: string;
};
export type TwEvidence = {
  version: 2;
  publisher: 'MND' | 'MOA' | 'FA' | 'MOTC';
  role: 'primary' | 'supplement';
  publication?: { value: string; precision: 'day' | 'instant'; evidence: string };
  issue?: { value: string; precision: 'day' | 'instant'; evidence: string };
  documents: TwReceipt[];
  attachments: { url: string; state: 'pending' | 'complete' | 'unsupported' | 'error'; reason?: string }[];
  bodyComplete: boolean;
  semanticComplete: boolean;
  rights: { status: 'metadata-open' | 'unverified'; url: string; detail: string };
  unresolved: string[];
  issueReference?: string;
  amendment?: {kind:'supersedes';targetReference:string;evidence:string};
  supersededBy?: string;
  historicalInterpretation?: Pick<Notice, 'start'|'end'|'validityPeriods'|'shapes'>;
};
export type TwNotice = Notice & { taiwan?: TwEvidence; sourceId?:string; publicProjection?:'facts-only' };
export function twEvidenceOf(notice:Notice):TwEvidence|undefined{return validateTaiwanEvidence((notice as TwNotice).taiwan) as TwEvidence||undefined;}
// The persistent two-hour/global admission is owned by the outer refresh.
// This structural type matches shared NavRequestBudget without another ledger.
export type TwBackoff={until:number;observedAt:number;status:number;url:string;reason:string};
export class TwSourceBackoff extends Error { readonly backoff:TwBackoff; constructor(backoff:TwBackoff){super(backoff.reason);this.name='TwSourceBackoff';this.backoff=backoff;} }
export type TwRequestBudget={bodyRequests:number;reserve:(kind:'listing'|'body',maxBytes:number)=>Promise<number>;finish:()=>void;readonly backoff?:TwBackoff;stopSource?:(value:TwBackoff)=>void};
export function twBudgetError(message:string):Error {const error=new Error(message);error.name='MaritimeBudgetDeferred';return error;}
export function twBoundBudget(budget:TwRequestBudget|undefined,maxRequests:number):TwRequestBudget {
  let used=0,backoff:TwBackoff|undefined;
  return {get backoff(){return backoff;},stopSource(value){backoff=value;},bodyRequests:Math.min(budget?.bodyRequests||0,maxRequests),finish:()=>{},reserve:async(kind,cap)=>{
    if(backoff)throw new TwSourceBackoff(backoff);
    if(!budget)throw twBudgetError('共有の永続取得許可がありません。新規通信は行いません');
    if(used>=maxRequests)throw twBudgetError('台湾発表元の今回の取得枠に達しました。次の2時間枠まで保留');
    used++;return budget.reserve(kind,cap);
  }};
}
export type TwResponse = { bytes: Uint8Array; receipt: TwReceipt };
export async function twSha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function twText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export function twDecode(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
      const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : +n;
      return cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\uFFFD';
    }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
export function twPlain(html: string): string {
  return twDecode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<(?:br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/[\t ]+/g, ' ').trim();
}
export function twDay(raw: string): string | undefined {
  const m = raw.trim().match(/^(20\d{2})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return;
  const n = Date.UTC(+m[1], +m[2]-1, +m[3]), d = new Date(n);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth()+1 !== +m[2] || d.getUTCDate() !== +m[3]) return;
  return d.toISOString().slice(0,10);
}
export function twOfficialUrl(raw: string, hosts: readonly string[], base?: string): string {
  const u = new URL(twDecode(raw), base);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts.includes(u.hostname)) throw new Error('未承認の台湾取得URL');
  u.hash = ''; return u.href;
}
export async function twGet(url: string, hosts: readonly string[], fetcher: typeof fetch, deadline: number, cap = 2_000_000, budget?:TwRequestBudget, kind:'listing'|'body'='body'): Promise<TwResponse> {
  let target = twOfficialUrl(url, hosts);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (Date.now() >= deadline) throw new Error('台湾取得時間上限');
    if(!budget)throw twBudgetError('共有の永続取得許可がありません。新規通信は行いません');
    const granted=await budget.reserve(kind,cap);
    if(!Number.isSafeInteger(granted)||granted<=0||granted>cap)throw twBudgetError('共有取得枠の応答サイズを確認できません');
    const r = await fetcher(target, { headers: { Accept: 'application/json,application/rss+xml,text/xml,text/html,application/pdf,application/vnd.oasis.opendocument.text' }, redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.min(7000, deadline-Date.now()))) });
    if ([301,302,303,307,308].includes(r.status)) {
      const location = r.headers.get('location'); await r.body?.cancel();
      if (!location || redirects === 3) throw new Error('台湾公式転送先を確認できません');
      target = twOfficialUrl(location, hosts, target); continue;
    }
    if([401,403,429,503].includes(r.status)){
      const observedAt=Date.now(),header=r.headers.get('retry-after'),seconds=header&&/^\d+$/.test(header)?Number(header):NaN;
      const retry=Number.isSafeInteger(seconds)?observedAt+seconds*1000:header?Date.parse(header):NaN;
      const until=header&&/^\d+$/.test(header)&&(!Number.isFinite(seconds)||seconds*1000+observedAt>8640000000000000)?8640000000000000:Number.isFinite(retry)&&retry>observedAt?Math.min(8640000000000000,Math.max(observedAt+2*3600000,retry)):observedAt+2*3600000;
      const backoff:TwBackoff={until,observedAt,status:r.status,url:target,reason:`台湾 HTTP ${r.status}。発表元の再試行待機まで以後の取得を停止します`};
      budget.stopSource?.(backoff);await r.body?.cancel();throw new TwSourceBackoff(backoff);
    }
    if (!r.ok) { await r.body?.cancel(); throw new Error(`台湾 HTTP ${r.status}`); }
    if (r.url && twOfficialUrl(r.url, hosts) !== target) { await r.body?.cancel(); throw new Error('台湾応答URLが要求先と異なります'); }
    if (Number(r.headers.get('content-length')) > granted) { await r.body?.cancel(); throw new Error('台湾応答サイズ上限'); }
    const chunks: Uint8Array[] = []; let size = 0;
    if (!r.body) throw new Error('台湾応答本文がありません');
    const reader = r.body.getReader();
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > granted) { await reader.cancel(); throw new Error('台湾応答サイズ上限'); } chunks.push(next.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const b of chunks) { bytes.set(b, offset); offset += b.length; }
    return { bytes, receipt: { url: target, requestedUrl: url, fetchedAt: Date.now(), status: r.status, bytes: size, sha256: await twSha256(bytes), mediaType: (r.headers.get('content-type') || '').split(';')[0].trim(), etag: r.headers.get('etag') || undefined, lastModified: r.headers.get('last-modified') || undefined, extraction: 'unread' } };
  }
  throw new Error('台湾公式転送回数上限');
}
// Only an unambiguous cancellation of this notice's own activity is final.
// Mentions of another notice, conditions, postponement and partial-date exclusions
// remain uncertain and cannot become a blanket cancellation.
export function twExplicitSelfCancellation(title:string,body:string):boolean{
 // Do not turn a cancelled date, conditional sentence, or cited other notice
 // into a cancellation of every activity in this record. Context spans lines.
 const context=title+'\n'+body;
 if(/如遇|如果|若|倘|除非|天候不佳|條件|部分|其他|其餘|照常|僅|限於|引用|引述|他案|未取消|不取消|未撤銷|不撤銷/.test(context))return false;
 // A title prefix or a sentence cut away from its qualifying paragraph does
 // not establish scope. Richer cancellation templates require separate review.
 return /^(?:本次(?:實彈)?射擊|本案|本次活動|本次操演)(?:已|予以)?(?:取消|撤銷|中止)[。！!；;，,]?\s*$/.test(body.trim());
}
export function twUnknown(notice: Notice, reason: string): Notice {
  return { ...notice, start: null, end: null, validityPeriods: [], shapes: [], timeUncertain: true, lifecycleUncertain: true, originals:undefined,taiwanPdf:undefined,taiwanPdfOriginal:undefined,taiwanPdfResult:undefined,taiwanEvidence:undefined,taiwanEvidenceHydration:undefined,staticSchedule:undefined,detail:undefined, warnings: [...new Set([...(notice.warnings||[]), reason])] } as Notice;
}
// Keep source-coordinate evidence independent of complete attachment semantics.
// Source references bind each shape to an actually extracted, successful document;
// older reviewed records may recover their exact ODT link from private source text.
export function twSupportedShapes(notice:Notice,now=Date.now()):Shape[]{
 const e=twEvidenceOf(notice);if(!e||notice.cancelled||e.supersededBy||!Array.isArray(notice.shapes))return [];
 const receipts=e.documents.filter(d=>d.status>=200&&d.status<300&&d.bytes>0&&d.extraction==='complete'&&d.fetchedAt<=now);
 const urls=new Set(receipts.flatMap(d=>[d.url,d.requestedUrl].filter((u):u is string=>!!u)));
 const extracted=typeof notice.text==='string'?notice.text.match(/ODT原文: (https:\/\/[^\s]+)/)?.[1]:undefined;
 const legacyReference=e.semanticComplete?(extracted&&urls.has(extracted)?extracted:e.attachments.length===1?e.attachments[0].url:undefined):undefined;
 return notice.shapes.filter(shape=>validTaiwanShape(shape)).flatMap(shape=>{
  const sourceReference=shape.sourceReference||legacyReference;
  if(!sourceReference||!urls.has(sourceReference)||sourceReference!==notice.sourceUrl&&!e.attachments.some(a=>a.url===sourceReference))return [];
  return [{kind:shape.kind,points:shape.points.map(p=>[p[0],p[1]] as [number,number]),provenance:'text' as const,sourceReference,...(shape.inferredClose===true&&shape.kind==='polygon'?{inferredClose:true}:{}),...(shape.partialBoundary===true?{partialBoundary:true}:{}),...(shape.approx===true?{approx:true}:{})}];
 });
}
export function twUncertainNotice(notice:Notice,reason:string,now=Date.now()):Notice{
 const shapes=twSupportedShapes(notice,now).map(shape=>({...shape,partialBoundary:true,approx:true}));
 const e=twEvidenceOf(notice),timingEvidence=!!e&&e.documents.some(d=>d.status>=200&&d.status<300&&d.bytes>0&&d.extraction==='complete'&&d.fetchedAt<=now);
 const periods=timingEvidence&&!notice.cancelled&&!e?.supersededBy&&validTaiwanPeriods(notice)?notice.validityPeriods||[]:[];
 return {...twUnknown(notice,reason),shapes,validityPeriods:periods.map(p=>({start:p.start,end:p.end})),start:periods.length?notice.start:null,end:periods.length?notice.end:null};
}
// A newer explicitly updated Coast Guard Fleet / Tamsui / month notice is a
// targeted conflict guard, not proof of cancellation or permission to copy geometry.
function coastguardScope(item: Notice): string | null {
  const text = item.location + '\n' + item.text;
  if (item.sourceCountry !== 'TW' || !/海巡署艦隊分署/.test(text) || !/淡水河口/.test(text)) return null;
  const match = text.match(/(?:(20\d{2})|(1\d{2}))年\s*(\d{1,2})月/);
  if (!match || +match[3] < 1 || +match[3] > 12) return null;
  return `coastguard-fleet/tamsui/${match[1] || +match[2]+1911}-${match[3].padStart(2,'0')}`;
}
function publication(item: TwNotice): string {
  return twEvidenceOf(item)?.publication?.value || (typeof item.issued==='number'&&Number.isFinite(item.issued)&&Math.abs(item.issued)<=8640000000000000?new Date(item.issued).toISOString():'');
}
export function reconcileTwVersions(items: Notice[]): Notice[] {
  const updates = items.filter((n): n is TwNotice => {const e=twEvidenceOf(n);return n.sourceCountry==='TW'&&(e?.amendment?.kind==='supersedes'||e?.bodyComplete===true&&/更新後|修正後|更正/.test(n.location)&&!!coastguardScope(n));});
  return items.map((notice): Notice => {
    if (notice.sourceCountry !== 'TW') return notice;
    const item = notice as TwNotice;
    if (item.cancelled) return { ...item, shapes: [], validityPeriods: [], start: null, end: null };
    const scope = coastguardScope(item);
    const newer = updates.filter(u => u.id !== item.id && ((!!twEvidenceOf(item)?.issueReference && twEvidenceOf(u)?.amendment?.targetReference===twEvidenceOf(item)?.issueReference) || !!scope && scope === coastguardScope(u) && publication(u).slice(0,10) > publication(item).slice(0,10))).sort((a,b)=>publication(b).localeCompare(publication(a)))[0];
    if (!newer) return item;
    const exact=!!twEvidenceOf(item)?.issueReference&&twEvidenceOf(newer)?.amendment?.targetReference===twEvidenceOf(item)?.issueReference;
    if(!exact)return twUncertainNotice(item,`同じ海域・月の後続公告があります。取消・置換の対象は未確認のため座標を要確認として保持します：${newer.sourceUrl}`);
    const reason = `後続の更新公告があります。旧資料は履歴として保持し、現在有効な区域とは表示しません：${newer.sourceUrl}`;
    const taiwan = twEvidenceOf(item);
    return { ...twUnknown(item, reason), ...(taiwan ? { taiwan: { ...taiwan, supersededBy: newer.sourceUrl, historicalInterpretation: taiwan.historicalInterpretation || { start:item.start, end:item.end, validityPeriods:item.validityPeriods, shapes:item.shapes }, unresolved: [...new Set([...taiwan.unresolved, reason])] } } : {}) } as TwNotice;
  });
}

// Public payload carries normalized facts and exact official links, not wholesale
// attachments or their contact blocks. Complete extraction remains in source evidence.
export function twPublicNotice(notice: Notice,now=Date.now()): Notice {
  const e=twEvidenceOf(notice);
  const verified=completeTaiwanEvidence(e,notice.sourceUrl,now)&&validTaiwanInterpretation(notice)&&!notice.cancelled&&!notice.lifecycleUncertain&&!e?.supersededBy;
  const item=(verified?notice:twUncertainNotice(notice,'本文・全添付または現在の有効性は未確認です。読取済み座標・日時は要確認の証拠として保持し、現行の活動とは断定しません。',now)) as TwNotice;
  const publicShapes=twSupportedShapes(item,now);
  const publicPeriods=validTaiwanPeriods(item)?(item.validityPeriods||[]).map(p=>({start:p.start,end:p.end})):[];
  const parts=[item.location,`公式原文: ${item.sourceUrl||''}`];
  if(e?.publication)parts.push(`掲載日: ${e.publication.value}（${e.publication.precision==='day'?'日付精度・時刻記載なし':'原文タイムスタンプ'}）`);
  if(e?.issue)parts.push(`発出日: ${e.issue.value}（${e.issue.precision==='day'?'時刻記載なし':'原文タイムスタンプ'}）`);
  if(e?.semanticComplete){
    parts.push(completeTaiwanEvidence(e,notice.sourceUrl,now)?'現在の本文・全添付を照合。原文で確認できたWGS84危険区域を解析。':'過去の本文・添付照合結果です。現在の資料の再確認が必要です。');
    
  }
  if(item.timeUncertain)parts.push(publicPeriods.length?'原文の実施時間を保持していますが、現在の有効性は未確定です。':'実施時間は未確定です。原文の不足や未解釈条件を推測で補っていません。');
  for(const p of publicPeriods)parts.push(`原文の実施区間（UTC、終了時刻は含まない・現行性は別途確認）: ${new Date(p.start).toISOString()} / ${new Date(p.end).toISOString()}`);
  for(const [i,s]of publicShapes.entries())parts.push(`WGS84読取座標${i+1}（緯度,経度${s.partialBoundary?'・境界未確定':''}）: ${s.points.map(p=>p.join(',')).join('; ')}`);
  for(const a of e?.attachments||[])parts.push(`原文添付 (${a.state}): ${a.url}`);
  for(const d of e?.documents||[])parts.push(`取得証跡: ${d.url} / SHA-256 ${d.sha256} / ${d.bytes} bytes / ${new Date(d.fetchedAt).toISOString()} / ${d.extraction}`);
  if(e?.amendment)parts.push(`更新根拠: ${e.amendment.evidence}`);
  if(e?.supersededBy)parts.push(`後続更新: ${e.supersededBy}`);
  if(!e?.semanticComplete)parts.push('本文・全添付の意味解析は未完了です。取得状況と公式原文を確認してください。');
  const explicitIssue=e?.issue?.precision==='instant'?Date.parse(e.issue.value):NaN;
  const publicEvidence=e?{version:e.version,publisher:e.publisher,role:e.role,publication:e.publication?{value:e.publication.value,precision:e.publication.precision,evidence:e.publication.evidence}:undefined,issue:e.issue?{value:e.issue.value,precision:e.issue.precision,evidence:e.issue.evidence}:undefined,documents:e.documents.map(d=>({url:d.url,requestedUrl:d.requestedUrl,fetchedAt:d.fetchedAt,status:d.status,bytes:d.bytes,sha256:d.sha256,mediaType:d.mediaType,extraction:d.extraction,reason:d.reason})),attachments:e.attachments.map(a=>({url:a.url,state:a.state,reason:a.reason})),bodyComplete:e.bodyComplete,semanticComplete:e.semanticComplete,rights:{status:e.rights.status,url:e.rights.url,detail:e.rights.detail},unresolved:[...e.unresolved],issueReference:e.issueReference,amendment:e.amendment?{kind:e.amendment.kind,targetReference:e.amendment.targetReference,evidence:e.amendment.evidence}:undefined,supersededBy:e.supersededBy}:undefined;
  const a=item.maritimeAttachment;
  return {id:item.id,location:item.location,text:parts.join('\n'),issued:Number.isFinite(explicitIssue)?explicitIssue:null,start:publicPeriods.length?item.start:null,end:publicPeriods.length?item.end:null,permanent:item.permanent===true,purpose:item.purpose,shapes:publicShapes,validityPeriods:publicPeriods,timeUncertain:!verified||item.timeUncertain===true,lifecycleUncertain:item.lifecycleUncertain===true,cancelled:item.cancelled===true,warnings:[...(item.warnings||[])],sourceUrl:item.sourceUrl,sourceName:item.sourceName,sourceCountry:'TW',regions:item.regions,maritimeAttachment:a?{status:a.status,format:a.format,sourceUrl:a.sourceUrl,checkedAt:a.checkedAt,bodyFetchedAt:a.bodyFetchedAt,detail:a.detail,textTruncated:a.textTruncated}:undefined,taiwan:publicEvidence,publicProjection:'facts-only'} as TwNotice;
}

export function twWithinHistory(notice:Notice,now=Date.now()):boolean {
 if(!Number.isFinite(now)||Math.abs(now)>8640000000000000)return true;
 const e=twEvidenceOf(notice);
 if(notice.cancelled||e?.supersededBy||e?.amendment||notice.permanent||/取消|撤銷|更正|修正|supersed|cancelled|canceled/i.test(notice.location))return true;
 if((notice.validityPeriods||[]).some(p=>Number.isFinite(p.end)&&p.end>now)||notice.end!==null&&Number.isFinite(notice.end)&&notice.end>now)return true;
 const day=e?.publication?.value.slice(0,10);if(!day||!twDay(day))return true;
 const cutoff=new Date(now);const wantedDay=cutoff.getUTCDate();cutoff.setUTCDate(1);cutoff.setUTCMonth(cutoff.getUTCMonth()-3);const last=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate();cutoff.setUTCDate(Math.min(wantedDay,last));return day>=cutoff.toISOString().slice(0,10);
}

export function twPriorBackoff(record:{taiwanBackoff?:TwBackoff},now=Date.now()):TwBackoff|undefined{const b=record.taiwanBackoff;return b&&Number.isFinite(b.until)&&b.until>now?b:undefined;}
export function twStopEvidence(error:unknown,budget?:TwRequestBudget):TwBackoff|undefined{return error instanceof TwSourceBackoff?error.backoff:budget?.backoff;}
