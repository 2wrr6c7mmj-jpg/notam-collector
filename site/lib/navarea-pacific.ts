/** Verified NAVAREA staging. Raw originals are internal; public output is facts-only. */
import type {Notice,Shape} from './notam';
import type {NavSource} from './nav-sources';
import type {SourceRecord} from './nav-store';
import type {NavRequestBudget} from './nav-collection-budget';
import {canonicalWarningNumber} from './nav-id';
import {navareaStorageBytes} from './navarea-storage-codec';
import {jcgCoordinates,militaryNav,parseJcgDetail} from './nav-jcg';
export type NavareaRegion='X'|'XIV'|'IX';
export const navareaSources:NavSource[]=[
 {id:'navarea-x',name:'AMSA NAVAREA X',region:'豪州周辺海域',country:'AU',parser:'navarea-public',url:'https://www.operations.amsa.gov.au/AMSA.Web.MSIPublication/Home'},
 {id:'navarea-xiv',name:'Maritime NZ NAVAREA XIV',region:'南太平洋',country:'NZ',parser:'navarea-public',url:'https://www.maritimenz.govt.nz/navigational-warnings/'},
 {id:'navarea-ix',name:'Pakistan NHO NAVAREA IX',region:'隣接インド洋・北西部',country:'PK',parser:'navarea-public',url:'https://hydrography.paknavy.gov.pk/navarea-ix-warnings/'},
];
const REGIONS:Record<string,NavareaRegion>={'navarea-x':'X','navarea-xiv':'XIV','navarea-ix':'IX'};
const DAY=86400000,TWO_HOURS=7200000,PARSER_VERSION=2,METADATA_HEADROOM=2048;
export const NAVAREA_MAX_RECORD_BYTES=1_800_000;
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
export type NavareaCancellation={targetId:string;self:boolean;effectiveAt:number|null;uncertain:boolean;conditional:boolean;basis:'issue-dtg'|'explicit-utc'|'unknown'};
export type NavareaEvidence={
 schemaVersion:2;parserVersion:2;navarea:NavareaRegion|'XI';warningIdentity:string;contentVersion:string;
 sourceInForceAt:number|null;observedInCurrentList:boolean|null;publishedAt:number|null;
 publishedAtKind:'broadcast-dtg'|'website-posting-hour'|'unknown';bodyFetchedAt:number|null;firstSeenAt:number;checkedAt:number;
 selfCancelAt:number|null;selfCancelImmediately:boolean;cancels:string[];cancellationEffects:NavareaCancellation[];cancellationUncertain:boolean;
 activityComplete:boolean;geometryUncertain:boolean;kind:'warning'|'in-force-summary'|'cancellation';clearanceNm:number|null;
 historyState:'current-publisher-snapshot'|'prior-snapshot-only';
};
export type NavareaNotice=Notice&{navareaEvidence:NavareaEvidence};
export type NavareaCachedResource={body:string;etag?:string;lastModified?:string;fetchedAt:number;requestUrl?:string;bodyHash?:string;parserVersion?:number};
export type NavareaPendingRow={id:string;url:string;indexIssued:number|null};
export type NavareaDiagnosticPhase='request-url'|'deadline'|'cache-bind'|'budget'|'request'|'response-url'|'redirect'|'cache-validate'|'http'|'body-limit'|'body-read'|'access-check'|'cache-hash'|'listing-parse'|'warning-parse'|'capacity';
const NAVAREA_DIAGNOSTIC_CODES={
 'request-url':'REQUEST_URL_REJECTED',deadline:'WALL_TIME_LIMIT','cache-bind':'CACHE_BINDING_FAILED',budget:'BUDGET_DEFERRED',request:'TRANSPORT_FAILED',
 'response-url':'RESPONSE_URL_REJECTED',redirect:'REDIRECT_REJECTED','cache-validate':'CACHE_VALIDATION_FAILED',http:'HTTP_ERROR',
 'body-limit':'BODY_LIMIT','body-read':'BODY_READ_FAILED','access-check':'ACCESS_RESTRICTION','cache-hash':'CACHE_HASH_FAILED',
 'listing-parse':'LISTING_PARSE_FAILED','warning-parse':'WARNING_PARSE_FAILED',capacity:'CAPACITY_DEFERRED',
} as const;
export type NavareaDiagnostic={schemaVersion:1;attemptedAt:number;code:typeof NAVAREA_DIAGNOSTIC_CODES[NavareaDiagnosticPhase];phase:NavareaDiagnosticPhase;requestKind:'listing'|'body';httpStatus:number|null};
/** Public/log boundary: construct exact fixed fields, never spread saved or upstream data. */
export function publicNavareaDiagnostic(value:unknown):NavareaDiagnostic|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const d=value as Record<string,unknown>;
 if(d.schemaVersion!==1||typeof d.attemptedAt!=='number'||!Number.isSafeInteger(d.attemptedAt)||d.attemptedAt<0||d.attemptedAt>8640000000000000||typeof d.phase!=='string'||!Object.hasOwn(NAVAREA_DIAGNOSTIC_CODES,d.phase)||d.code!==NAVAREA_DIAGNOSTIC_CODES[d.phase as NavareaDiagnosticPhase]||!['listing','body'].includes(d.requestKind as string)||d.httpStatus!==null&&!(typeof d.httpStatus==='number'&&Number.isInteger(d.httpStatus)&&d.httpStatus>=100&&d.httpStatus<=599))return null;
 return {schemaVersion:1,attemptedAt:d.attemptedAt,code:d.code as NavareaDiagnostic['code'],phase:d.phase as NavareaDiagnosticPhase,requestKind:d.requestKind as 'listing'|'body',httpStatus:d.httpStatus as number|null};
}
export type NavareaRecord=Omit<SourceRecord,'status'>&{status:SourceRecord['status']&{navareaDiagnostic?:NavareaDiagnostic};
 navareaCache?:Record<string,NavareaCachedResource>;navareaCacheVersions?:Record<string,NavareaCachedResource>;
 navareaVersions?:Record<string,NavareaNotice>;navareaPending?:string[];
 navareaPendingRows?:NavareaPendingRow[];navareaRetry?:string[];navareaDeferred?:string[];
 navareaBackoff?:{nextAllowedAt:number;status:number|null;blocked:boolean;reason:'http'|'transport'|'access'};
 navareaCapacityDeferred?:boolean;
};
function plain(s:string){return s.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?>|<\/(?:p|div|h\d|li|tr|section)>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):+n)).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();}
function utc(year:number,month:number,day:number,hour=0,minute=0){if(year<2000||year>2100||month<0||month>11||hour>23||minute>59)return null;const n=Date.UTC(year,month,day,hour,minute),d=new Date(n);return d.getUTCFullYear()===year&&d.getUTCMonth()===month&&d.getUTCDate()===day?n:null;}
export function navareaUtcDtg(s:string):number|null{const m=s.trim().toUpperCase().match(/^(\d{2})(\d{2})(\d{2})(?:Z|\s+UTC)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{2}|20\d{2})\b/);return m?utc(m[5].length===2?2000+ +m[5]:+m[5],MONTHS.indexOf(m[4]),+m[1],+m[2],+m[3]):null;}
export function navareaHistoryCutoff(now:number){const d=new Date(now),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-3);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.getTime();}
async function exactHash(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function hash(s:string){return exactHash(s.normalize('NFKC').replace(/\s+/g,' ').trim());}
function identity(region:string,number:string){const out=canonicalWarningNumber(`NAVAREA ${region} ${number}`);if(!out)throw new Error('NAVAREA warning identity invalid');return out;}
function activity(text:string){
 const s=text.split(/\bCANCEL\b/i)[0].toUpperCase();
 const re=/\bDAILY FROM (\d{1,2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) TO (\d{1,2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (20\d{2}) BETWEEN (\d{2})(\d{2}) UTC AND (\d{2})(\d{2}) UTC\b/g;
 const periods:{start:number;end:number}[]=[];let remaining=s,uncertain=false;
 for(const m of s.matchAll(re)){
  remaining=remaining.replace(m[0],' ');const a=utc(+m[5],MONTHS.indexOf(m[2]),+m[1]),b=utc(+m[5],MONTHS.indexOf(m[4]),+m[3]);
  const startMin=+m[6]*60+ +m[7],endMin=+m[8]*60+ +m[9];
  if(a===null||b===null||b<a||b-a>93*DAY||+m[6]>23||+m[8]>23||+m[7]>59||+m[9]>59||endMin<=startMin){uncertain=true;continue;}
  for(let d=a;d<=b;d+=DAY)periods.push({start:d+startMin*60000,end:d+endMin*60000});
 }
 // Exact known intervals can survive, but never certify an unmatched additional schedule.
 if(/\b\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b|\b(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|WEEKDAYS?|WEEKENDS?|FIRING|GUNNERY|EXERCISE)\b|\b(?:DAILY|BETWEEN|UNTIL|BEFORE|AFTER|EVERY|ALTERNATE|EXCEPT|INTERMITTENT|COMMENCING)\b|\b\d{4,6}\s*(?:UTC|Z)\b|\b(?:ADDITIONAL|ALSO|FURTHER)\b[^\n]*\b(?:OPERATIONS?|FIRING|ACTIVIT\w*|EXERCISE|LAUNCH)/i.test(remaining))uncertain=true;
 const unique=[...new Map(periods.map(p=>[`${p.start}/${p.end}`,p])).values()].sort((a,b)=>a.start-b.start);
 return {periods:unique,timeUncertain:uncertain||!unique.length};
}
function simpleRing(points:[number,number][]){
 const same=(a:number[],b:number[])=>a[0]===b[0]&&a[1]===b[1];
 const ring=points.length>1&&same(points[0],points[points.length-1])?points.slice(0,-1):points;
 if(ring.length<3||ring.length>512||new Set(ring.map(p=>p.join(','))).size!==ring.length)return false;
 const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const eps=1e-12,on=(a:number[],b:number[],p:number[])=>Math.abs(cross(a,b,p))<=eps&&p[0]>=Math.min(a[0],b[0])-eps&&p[0]<=Math.max(a[0],b[0])+eps&&p[1]>=Math.min(a[1],b[1])-eps&&p[1]<=Math.max(a[1],b[1])+eps;
 let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}
 if(Math.abs(area)<=eps)return false;
 for(let i=0;i<ring.length;i++)for(let j=i+1;j<ring.length;j++){
  if(j===(i+1)%ring.length||i===(j+1)%ring.length)continue;
  const a=ring[i],b=ring[(i+1)%ring.length],c=ring[j],d=ring[(j+1)%ring.length];
  const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);
  if(((x>eps&&y< -eps||x< -eps&&y>eps)&&(z>eps&&w< -eps||z< -eps&&w>eps))||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return false;
 }
 return true;
}
function geometry(text:string):{shapes:Shape[];uncertain:boolean}{
 const normalized=text.replace(/–/g,'-').replace(/([NS])\s*[,/]\s*/g,'$1 '),coords=jcgCoordinates(normalized);
 const points=():Shape[]=>coords.map(p=>({kind:'point',points:[p],provenance:'text',approx:true,partialBoundary:true}));
 if(!coords.length)return {shapes:[],uncertain:true};
 const candidates=[...normalized.matchAll(/\b\d{1,2}-[\d.-]+[NS]\s+\d{1,3}-[\d.-]+[EW]\b/g)];
 const markers=[...normalized.matchAll(/\bALONG THE FOLLOWING LINE\s*:|\bAREA BOUND(?:ED)? BY\s*:|\bIN FOLLOWING AREA\s*:/gi)];
 const complicated=/\b(?:EXCEPT|EXCL|EXCLUDING|OUTSIDE|RADIUS|ARC|COASTLINE|SHORELINE|AREAS)\b/i.test(normalized)||candidates.length!==coords.length||coords.some((p,i)=>i>0&&Math.abs(p[1]-coords[i-1][1])>180);
 if(complicated||markers.length!==1)return {shapes:points(),uncertain:complicated||markers.length>0||coords.length>1};
 const marker=markers[0],tail=normalized.slice(marker.index!+marker[0].length),lines=tail.split('\n');
 const coordinateLine=/^\s*(?:[A-Z]\.?\s*)?\d{1,2}-\d{2}(?:\.\d+)?(?:-\d{2}(?:\.\d+)?)?[NS]\s+\d{1,3}-\d{2}(?:\.\d+)?(?:-\d{2}(?:\.\d+)?)?[EW]\.?\s*$/;
 let started=false,blockCount=0;for(const line of lines){if(!line.trim())continue;if(coordinateLine.test(line)){started=true;blockCount++;}else if(started)break;else return {shapes:points(),uncertain:true};}
 // All coordinates must belong to this single proven consecutive vertex block.
 if(blockCount!==coords.length)return {shapes:points(),uncertain:true};
 const kind=/LINE/i.test(marker[0])?'line':'polygon';
 if(coords.length<(kind==='line'?2:3)||kind==='polygon'&&(!simpleRing(coords)||Math.abs(coords[coords.length-1][1]-coords[0][1])>180))return {shapes:points(),uncertain:true};
 return {shapes:[{kind,points:coords,...(kind==='polygon'?{inferredClose:true}:{}),provenance:'text'}],uncertain:false};
}
function lifecycle(text:string,id:string,issued:number|null){
 const effects:NavareaCancellation[]=[];const matches=[...text.matchAll(/\bCANCEL\b/gi)];
 for(let i=0;i<matches.length;i++){
  const clause=text.slice(matches[i].index!,matches[i+1]?.index??text.length).split(/\bNNNN\b/)[0].trim();
  const targetMatches=[...clause.matchAll(/\bNAVAREA (XIV|XIII|XII|XI|IX|VIII|X)\s+(?:WARNING\s+)?(\d{1,5}\/\d{2,4})\b/gi)];
  const targets=targetMatches.map(m=>identity(m[1].toUpperCase(),m[2]));const self=/\b(?:CANCEL|AND) THIS (?:MESSAGE|MSG)\b/i.test(clause);if(self)targets.push(id);
  if(!targets.length)continue;
  let residual=clause.replace(/^CANCEL\s+/i,'').replace(/NAVAREA (?:XIV|XIII|XII|XI|IX|VIII|X)\s+(?:WARNING\s+)?\d{1,5}\/\d{2,4}/gi,'').replace(/\b(?:AND\s+)?THIS (?:MESSAGE|MSG)\b/gi,'').trim().replace(/[.\s]+$/,'').trim();
  const prefix=text.slice(Math.max(0,matches[i].index!-240),matches[i].index!),sameLine=prefix.split('\n').at(-1)!.replace(/^\s*\d+\.\s*/,'').trim();
  const conditional=/\b(?:IF|WHEN|UNTIL|AFTER|UPON|UNLESS|SUBJECT|PENDING|ON COMPLETION|EXCEPT)\b/i.test(clause)||/\b(?:IF|WHEN|UPON|UNLESS|SUBJECT|DO NOT)\b|\b(?:AT|AFTER|FROM)\s+\d{4,6}/i.test(prefix)||Boolean(sameLine);
  const explicit=residual.replace(/^AT\s+/i,'');const explicitAt=/^\d{6}(?:Z|\s+UTC)\s+[A-Z]{3}\s+(?:\d{2}|20\d{2})$/i.test(explicit)?navareaUtcDtg(explicit):null;
  if(explicitAt!==null)residual='';
  const unqualified=!conditional&&!residual;
  const effectiveAt=unqualified?(explicitAt??issued):null;
  for(const targetId of new Set(targets))effects.push({targetId,self:targetId===id,effectiveAt,uncertain:!unqualified||effectiveAt===null||(explicitAt!==null&&issued!==null&&explicitAt<issued),conditional,basis:!unqualified||effectiveAt===null?'unknown':explicitAt!==null?'explicit-utc':'issue-dtg'});
 }
 return effects;
}
const due=(e:NavareaCancellation,issued:number|null,now:number)=>!e.uncertain&&!e.conditional&&e.effectiveAt!==null&&e.effectiveAt<=now&&(issued===null||issued<=now);
export async function parseNavareaWarning(raw:string,source:NavSource,context:{url?:string;now:number;bodyFetchedAt:number;sourceInForceAt:number|null;previous?:NavareaNotice}):Promise<NavareaNotice>{
 const region=REGIONS[source.id];if(!region)throw new Error('Unverified NAVAREA source');
 const text=plain(raw),match=text.match(/^NAVAREA (?:XIV|IX|X)(?: WARNING)? (\d{1,5}\/\d{2,4})\b/m);if(!match)throw new Error('NAVAREA full-body header missing');
 if(text.match(/^NAVAREA (XIV|IX|X)(?: WARNING)? /m)?.[1]!==region)throw new Error('NAVAREA header/source mismatch');
 const id=identity(region,match[1]),old=context.previous?.navareaEvidence,header=text.slice(0,text.indexOf(match[0])).trim().split('\n').at(-1)||'';
 const issued=navareaUtcDtg(header.replace(/^FM (?:JRCC|RCC) AUSTRALIA\s+/i,''));if(issued!==null&&new Date(issued).getUTCFullYear()!==Number(id.split('/').at(-1)))throw new Error('NAVAREA issue year and warning identity conflict');
 const schedule=activity(text),periods=schedule.periods,effects=lifecycle(text,id,issued),self=effects.filter(e=>e.self);
 const cancels=[...new Set(effects.filter(e=>!e.self).map(e=>e.targetId))],selfCancelAt=self.find(e=>e.basis==='explicit-utc')?.effectiveAt??null;
 const selfCancelImmediately=self.some(e=>e.basis==='issue-dtg'&&!e.uncertain&&!e.conditional);
 const cancellationUncertain=effects.some(e=>e.uncertain||e.conditional||e.effectiveAt===null||e.effectiveAt>context.now)||(issued!==null&&issued>context.now);
 const kind=/\bWARNINGS? IN\s*FORCE\b/i.test(text)?'in-force-summary':effects.length&&!jcgCoordinates(text).length?'cancellation':'warning';
 const cancelled=self.some(e=>due(e,issued,context.now)),geo=geometry(text),clearance=text.match(/(?:AT LEAST\s+)?(\d+(?:\.\d+)?)\s*NM\s+CLEARANCE|WIDE BERTH OF AT LEAST\s+(\d+(?:\.\d+)?)\s*NM/i);
 const warnings=['公開Web警報の確認用。正式な安全放送の代替ではありません。','発表元の国は活動実施国・海域の主権を示しません。'];
 if(schedule.timeUncertain)warnings.push('活動日程は全部または一部が未確認。発行・在効・取消日時を活動期間には流用しません。');
 if(issued===null)warnings.push('警報ごとの発行日時なし。取得時刻や在効基準時刻では補完しません。');
 if(cancellationUncertain)warnings.push('将来または条件付きの取消を直ちに適用しません。');
 if(geo.uncertain)warnings.push('区域の対応が未確定な場合は独立座標のみ保持します。');
 return {id,location:`NAVAREA ${region}`,text,issued,start:periods[0]?.start??null,end:periods.at(-1)?.end??null,permanent:false,validityPeriods:periods,timeUncertain:schedule.timeUncertain,lifecycleUncertain:cancellationUncertain||(!cancelled&&selfCancelAt===null),cancelled,purpose:militaryNav.test(text)?'firing':'other',shapes:cancelled||kind!=='warning'?[]:geo.shapes,warnings,sourceUrl:context.url||source.url,sourceName:source.name,sourceCountry:source.country,maritimeTimeBasis:{zone:'UTC',disclosure:'原文に明記されたUTC時刻のみ使用。',sourceUrl:context.url||source.url},navareaEvidence:{schemaVersion:2,parserVersion:2,navarea:region,warningIdentity:id,contentVersion:await hash(text),sourceInForceAt:context.sourceInForceAt,observedInCurrentList:true,publishedAt:issued,publishedAtKind:issued===null?'unknown':'broadcast-dtg',bodyFetchedAt:context.bodyFetchedAt,firstSeenAt:old?.firstSeenAt??context.now,checkedAt:context.now,selfCancelAt,selfCancelImmediately,cancels,cancellationEffects:effects,cancellationUncertain,activityComplete:!schedule.timeUncertain,geometryUncertain:geo.uncertain,kind,clearanceNm:clearance?+(clearance[1]||clearance[2]):null,historyState:'current-publisher-snapshot'}};
}

export function navareaPage(html:string,source:NavSource){
 const region=REGIONS[source.id],text=plain(html);let section:string,asOf:number|null;
 if(region==='X'){
  if(!text.includes('Part 2. NAVAREA X warnings:')||!text.includes('Part 3. Coastal warnings:'))throw new Error('AMSA page schema changed');
  section=text.split('Part 2. NAVAREA X warnings:')[1].split('Part 3. Coastal warnings:')[0];
  asOf=navareaUtcDtg(text.match(/Maritime Safety Information current at ([^\n]+)/i)?.[1]||'');
 }else if(region==='XIV'){
  if(!text.includes('NAVAREA XIV warnings')||!text.includes('NZ Coastal Navigation warnings'))throw new Error('Maritime NZ page schema changed');
  section=text.split('NAVAREA XIV warnings')[1].split('NZ Coastal Navigation warnings')[0];
  asOf=navareaUtcDtg(text.match(/Warnings In-Force at:\s*([^\n]+)/i)?.[1]||'');
 }else throw new Error('NAVAREA region requires attachment index');
 const warnings=region==='X'?[...section.matchAll(/SECURITE[\s\S]*?NNNN/g)].map(m=>m[0]):[...section.matchAll(/NAVAREA XIV WARNING[\s\S]*?NNNN/g)].map(m=>m[0]);
 if(asOf===null||!warnings.length)throw new Error('No verified full NAVAREA bodies or snapshot time; keep last good');
 return {warnings,asOf};
}
export function navareaIxIndex(html:string,source:NavSource){
 if(source.id!=='navarea-ix'||!plain(html).includes('NAVAREA IX WARNINGS'))throw new Error('Pakistan NHO index schema changed');
 const rows=[];
 for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const t=plain(m[1]),number=t.match(/\b(\d{1,5}\/\d{2,4})\b/)?.[1],href=m[1].match(/href=["']([^"']+\.txt)["']/i)?.[1];if(!number||!href)continue;
  const url=new URL(href,source.url);if(url.origin!==new URL(source.url).origin||!url.pathname.startsWith('/wp-content/plugins/navarea-warnings/custom_uploaded_warnings_for_navarea/'))continue;
  const rawDtg=t.match(/\b\d{6}\s+UTC\s+[A-Z]+\s+\d{2,4}\b/i)?.[0]||'';
  rows.push({id:identity('IX',number),url:url.href,indexIssued:navareaUtcDtg(rawDtg)});
 }
 if(!rows.length)throw new Error('Pakistan index has no verified text attachment rows');return rows;
}
export function reconcileNavarea(items:NavareaNotice[],listed:Set<string>,now:number){
 const historicallyCancelled=new Set(items.filter(n=>n.cancelled===true).map(n=>n.id));
 const byId=new Map<string,NavareaNotice>();for(const n of items)byId.set(n.id,n);
 const cancelledIds=new Set<string>();
 for(const n of byId.values())for(const e of n.navareaEvidence.cancellationEffects||[])if(due(e,n.issued,now))cancelledIds.add(e.targetId);
 // No old originals or cancellation pairs are deleted. Intake capacity is enforced separately.
 return [...byId.values()].map(n=>{
  const e=n.navareaEvidence,known=e.parserVersion===PARSER_VERSION&&Array.isArray(e.cancellationEffects),cancelled=historicallyCancelled.has(n.id)||(known&&cancelledIds.has(n.id));
  const uncertain=!known||(e.cancellationEffects||[]).some(c=>c.uncertain||c.conditional||c.effectiveAt===null||c.effectiveAt>now)||(n.issued!==null&&n.issued>now);
  return {...n,cancelled,shapes:cancelled?[]:n.shapes,lifecycleUncertain:uncertain||!listed.has(n.id)||n.lifecycleUncertain,navareaEvidence:{...e,cancellationUncertain:uncertain,observedInCurrentList:listed.has(n.id)}};
 });
}
const bytesOf=navareaStorageBytes;
class SourceStop extends Error{constructor(readonly backoff:NonNullable<NavareaRecord['navareaBackoff']>,message:string){super(message);}}
export function navareaRetryAfter(value:string|null,now:number){
 if(value&&/^\d+$/.test(value.trim())){const n=Number(value.trim());if(Number.isSafeInteger(n)&&n<=315360000)return Math.max(now+TWO_HOURS,now+n*1000);}
 if(value&&/GMT$/i.test(value.trim())){const n=Date.parse(value);if(Number.isFinite(n)&&n>now)return Math.max(now+TWO_HOURS,n);}
 return now+TWO_HOURS;
}
function allowedUrl(url:string,source:NavSource){
 try{const u=new URL(url),base=new URL(source.url);if(u.origin!==base.origin||u.username||u.password||u.hash||u.search)return false;
  if(source.id==='navarea-x')return u.pathname.startsWith('/AMSA.Web.MSIPublication/');
  if(source.id==='navarea-xiv')return u.pathname==='/navigational-warnings/'||u.pathname==='/navigational-warnings';
  return u.href===base.href||u.pathname.startsWith('/wp-content/plugins/navarea-warnings/custom_uploaded_warnings_for_navarea/')&&u.pathname.endsWith('.txt');
 }catch{return false;}
}
function withoutDiagnostic(record:NavareaRecord):NavareaRecord{
 if(!Object.hasOwn(record.status,'navareaDiagnostic'))return record;
 const status={...record.status};delete status.navareaDiagnostic;return {...record,status};
}
function cappedResult(previous:NavareaRecord,next:NavareaRecord):NavareaRecord{
 // Optional telemetry cannot displace newly collected facts or stored originals.
 if(bytesOf(next)>NAVAREA_MAX_RECORD_BYTES-METADATA_HEADROOM)next=withoutDiagnostic(next);
 if(bytesOf(next)<=NAVAREA_MAX_RECORD_BYTES-METADATA_HEADROOM)return next;
 const fallback={...previous,navareaBackoff:next.navareaBackoff??previous.navareaBackoff,navareaCapacityDeferred:true,status:{...previous.status,checkedAt:next.status.checkedAt,state:'partial' as const,detail:'NAVAREA総保存量1,800,000バイト上限。既存原文・履歴を削除せず新規取込を保留。'}};
 return bytesOf(fallback)<=NAVAREA_MAX_RECORD_BYTES?fallback:previous;
}
/** Outer dispatcher owns admission and budget.finish(), including early/error returns. */
export async function collectNavareaSource(source:NavSource,previous:NavareaRecord,options:{budget:NavRequestBudget;fetcher:typeof fetch;enabled?:boolean;now?:number;maxDetails?:number}):Promise<NavareaRecord>{
 const now=options.now??Date.now(),budget=options.budget,region=REGIONS[source.id];
 const preserve=(state:'partial'|'error',detail:string)=>cappedResult(previous,{...previous,status:{...previous.status,checkedAt:now,state,detail}});
 if(!options.enabled||!region||!budget||!options.fetcher||source.url!==navareaSources.find(s=>s.id===source.id)?.url)return preserve('partial','NAVAREA取得は既定で無効。共通予算と公開境界の確認待ち。');
 if(bytesOf(withoutDiagnostic(previous))>=NAVAREA_MAX_RECORD_BYTES-METADATA_HEADROOM)return cappedResult(previous,{...previous,navareaCapacityDeferred:true,status:{...previous.status,checkedAt:now,state:'partial',navareaDiagnostic:{schemaVersion:1,attemptedAt:now,code:'CAPACITY_DEFERRED',phase:'capacity',requestKind:'listing',httpStatus:null},detail:'既存原文を保持し、総保存量上限で新規取込を保留。'}});
 if(previous.navareaBackoff&&(previous.navareaBackoff.blocked||previous.navareaBackoff.nextAllowedAt>now))return preserve('partial','NAVAREA配信元の停止・待機条件を保持。自動再試行は行いません。');
 if(previous.items.some(n=>!('navareaEvidence' in n)))return preserve('error','既存NAVAREA形式未確認。原文を保持。');
 const cache={...previous.navareaCache},cacheVersions={...previous.navareaCacheVersions},versions={...previous.navareaVersions};
 const items=previous.items as NavareaNotice[],incoming:NavareaNotice[]=[],deadline=Date.now()+25000;
 let pages=0,newBodies=0,failed=0,errorMessage='',backoff:NavareaRecord['navareaBackoff'];let pending=[...(previous.navareaPending||[])],retryUrls=[...(previous.navareaRetry||[])],deferred=[...(previous.navareaDeferred||[])],pendingRows=[...(previous.navareaPendingRows||[])];const listed=new Set<string>();let validIndex=false;
 let phase:NavareaDiagnosticPhase='request-url',requestKind:'listing'|'body'='listing',httpStatus:number|null=null,requestsStarted=0,diagnostic:NavareaDiagnostic|undefined;
 const failedAttempt=()=>{if(!diagnostic)diagnostic={schemaVersion:1,attemptedAt:now,code:NAVAREA_DIAGNOSTIC_CODES[phase],phase,requestKind,httpStatus};};
 async function get(initialUrl:string,kind:'listing'|'body',maxBytes:number){
  phase='request-url';requestKind=kind;httpStatus=null;let url=new URL(initialUrl).href;const seen=new Set<string>();
  for(let hop=0;hop<3;hop++){
   if(seen.has(url)){phase='redirect';throw new Error('Unverified or cyclic NAVAREA redirect');}
   phase='request-url';httpStatus=null;if(!allowedUrl(url,source))throw new Error('Unverified or cyclic NAVAREA redirect');seen.add(url);
   phase='deadline';if(Date.now()>deadline)throw new Error('NAVAREA wall-time limit');
   phase='cache-bind';const cached=cache[url],bound=Boolean(cached&&cached.requestUrl===url&&cached.parserVersion===PARSER_VERSION&&cached.bodyHash===await exactHash(cached.body));
   const headers:Record<string,string>={Accept:kind==='body'?'text/plain':'text/html'};
   if(bound&&cached.etag)headers['If-None-Match']=cached.etag;else if(bound&&cached.lastModified)headers['If-Modified-Since']=cached.lastModified;
   const conditional=Boolean(headers['If-None-Match']||headers['If-Modified-Since']);
   phase='budget';const cap=await budget.reserve(kind,maxBytes);let response:Response;
   phase='request';requestsStarted++;try{response=await options.fetcher(url,{method:'GET',redirect:'manual',headers,signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-Date.now())))});}
   catch{throw new SourceStop({nextAllowedAt:now+TWO_HOURS,status:null,blocked:false,reason:'transport'},'NAVAREA transport failure');}
   httpStatus=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:null;phase='response-url';
   // A transport that auto-followed or cannot identify its response is not trustworthy here.
   if(!response.url||response.redirected||response.url!==url||!allowedUrl(response.url,source)){await response.body?.cancel();throw new Error('NAVAREA response URL mismatch');}
   if([301,302,303,307,308].includes(response.status)){
    phase='redirect';await response.body?.cancel();const location=response.headers.get('location');if(!location)throw new Error('Redirect without location');
    const target=new URL(location,url).href;if(!allowedUrl(target,source))throw new Error('Unverified NAVAREA redirect');url=target;continue;
   }
   if(response.status===304){
    phase='cache-validate';await response.body?.cancel();if(!bound||!conditional||!cached)throw new Error('Unsolicited or unbound NAVAREA 304');
    const etag=response.headers.get('etag'),modified=response.headers.get('last-modified');
    if(headers['If-None-Match']&&etag!==cached.etag||headers['If-Modified-Since']&&modified!==cached.lastModified||etag&&cached.etag&&etag!==cached.etag||modified&&cached.lastModified&&modified!==cached.lastModified)throw new Error('NAVAREA 304 validator mismatch');
    pages++;return {body:cached.body,next:cached,changed:false,url};
   }
   if(!response.ok){
    phase='http';await response.body?.cancel();if([401,403,429,503].includes(response.status))throw new SourceStop({nextAllowedAt:navareaRetryAfter(response.headers.get('retry-after'),now),status:response.status,blocked:response.status===401||response.status===403,reason:'http'},`NAVAREA HTTP ${response.status}`);
    throw new Error(`NAVAREA HTTP ${response.status}`);
   }
   phase='body-limit';if(Number(response.headers.get('content-length'))>cap){await response.body?.cancel();throw new Error('NAVAREA declared body exceeds reserved bytes');}
   phase='body-read';const reader=response.body?.getReader();let count=0;const chunks:Uint8Array[]=[];
   if(reader)while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>cap){phase='body-limit';await reader.cancel();throw new Error('NAVAREA body exceeds reserved bytes');}chunks.push(part.value);}
   const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const body=new TextDecoder().decode(bytes);phase='access-check';if(/ACCESS DENIED|<title[^>]*>\s*(?:Just a moment|Forbidden)/i.test(body))throw new SourceStop({nextAllowedAt:now+TWO_HOURS,status:response.status,blocked:true,reason:'access'},'NAVAREA access restriction');
   phase='cache-hash';pages++;const next:NavareaCachedResource={body,requestUrl:url,bodyHash:await exactHash(body),parserVersion:PARSER_VERSION,etag:response.headers.get('etag')||undefined,lastModified:response.headers.get('last-modified')||undefined,fetchedAt:now};return {body,next,changed:true,url};
  }phase='redirect';throw new Error('NAVAREA redirect limit');
 }
 async function commitResource(url:string,next:NavareaCachedResource){
  const old=cache[url];if(old&&old.body!==next.body){const key=url+'|'+(old.bodyHash||await exactHash(old.body))+'|v'+(old.parserVersion||0);if(!cacheVersions[key])cacheVersions[key]=old;}
  cache[url]=next;
 }
 function archiveOld(n:NavareaNotice){const old=items.find(x=>x.id===n.id);if(old&&(old.navareaEvidence.contentVersion!==n.navareaEvidence.contentVersion||old.navareaEvidence.parserVersion!==PARSER_VERSION)){const key=old.id+'|'+old.navareaEvidence.contentVersion+'|v'+old.navareaEvidence.parserVersion;if(!versions[key])versions[key]=old;}}
 try{
  const listing=await get(source.url,'listing',region==='IX'?384*1024:region==='XIV'?128*1024:64*1024);
  if(region==='IX'){
   phase='listing-parse';const rows=navareaIxIndex(listing.body,source);for(const row of rows)listed.add(row.id);
   const prior=new Map(items.map(n=>[n.id,n])),cutoff=navareaHistoryCutoff(now);
   // Recover witnessed identities from the previous verified index when upgrading
   // an older URL-only queue. Never guess an identity from an attachment filename.
   const witnessed=new Map<string,NavareaPendingRow>();
   const priorListing=cache[source.url];
   if(priorListing?.requestUrl===source.url&&priorListing.bodyHash===await exactHash(priorListing.body)){
    try{for(const row of navareaIxIndex(priorListing.body,source))witnessed.set(row.url,row);}catch{/* Existing originals remain intact. */}
   }
   for(const row of pendingRows)if(row&&allowedUrl(row.url,source)&&canonicalWarningNumber(row.id)===row.id&&row.id.startsWith('NAVAREA IX ')&&(row.indexIssued===null||Number.isSafeInteger(row.indexIssued)))witnessed.set(row.url,row);
   const oldUrls=new Set([...(previous.navareaPending||[]),...(previous.navareaDeferred||[])]);
   const byUrl=new Map([...witnessed,...rows.map(r=>[r.url,r] as const)]);
   const references=new Set(items.flatMap(n=>[...(n.navareaEvidence.cancels||[]),...(n.navareaEvidence.cancellationEffects||[]).map(c=>c.targetId)]));
   const eligible=(row:NavareaPendingRow)=>row.indexIssued===null||row.indexIssued>=cutoff||references.has(row.id)||!!prior.get(row.id)?.permanent||(prior.get(row.id)?.end??0)>now;
   const priorQueue=[...oldUrls].filter(url=>byUrl.has(url)&&eligible(byUrl.get(url)!));
   deferred=[...new Set([...oldUrls,...rows.map(r=>r.url)])].filter(url=>byUrl.has(url)&&!eligible(byUrl.get(url)!));
   // Truly new/changed publisher rows lead. Existing failed rows keep their
   // durable round-robin order rather than jumping back to the head every run.
   const revised=rows.filter(r=>eligible(r)&&(prior.has(r.id)&&prior.get(r.id)?.sourceUrl!==r.url||witnessed.has(r.url)&&witnessed.get(r.url)!.indexIssued!==r.indexIssued));
   const fresh=rows.filter(r=>eligible(r)&&!oldUrls.has(r.url)&&!prior.has(r.id));
   const currentRefresh=rows.slice(0,2).filter(r=>eligible(r)&&prior.has(r.id));
   pending=[...new Set([...revised.map(r=>r.url),...fresh.map(r=>r.url),...priorQueue,...currentRefresh.map(r=>r.url)])];
   // Keep any legacy queue URLs whose identity cannot be recovered, but do not
   // fetch them or imply coverage. A later verified listing can recover them.
   const unresolved=[...oldUrls].filter(url=>allowedUrl(url,source)&&!byUrl.has(url));
   deferred=[...new Set([...deferred,...unresolved])];
   pendingRows=[...new Set([...pending,...deferred])].flatMap(url=>byUrl.has(url)?[byUrl.get(url)!]:[]);
   const staged={...previous,navareaPending:pending,navareaPendingRows:pendingRows,navareaDeferred:deferred};
   phase='capacity';if(bytesOf(withoutDiagnostic(staged))>NAVAREA_MAX_RECORD_BYTES-METADATA_HEADROOM)throw new Error('NAVAREA pending capacity; previous queue retained');
   validIndex=true;await commitResource(listing.url,listing.next);
   const retry:string[]=[];const limit=Math.min(4,Math.max(0,options.maxDetails??4),budget.bodyRequests);
   for(let attempt=0;attempt<limit&&pending.length&&Date.now()<deadline-1000;attempt++){
    const url=pending.shift()!,row=byUrl.get(url)!;
    try{const result=await get(url,'body',64*1024);phase='warning-parse';const n=await parseNavareaWarning(result.body,source,{url,now,bodyFetchedAt:result.next.fetchedAt,sourceInForceAt:null,previous:prior.get(row.id)});if(n.id!==row.id)throw new Error('NAVAREA attachment identity mismatch');archiveOld(n);incoming.push(n);await commitResource(result.url,result.next);if(result.changed)newBodies++;}
    catch(error){failedAttempt();failed++;retry.push(url);if(error instanceof SourceStop){backoff=error.backoff;errorMessage=error.message;break;}if(error instanceof Error&&error.name==='MaritimeBudgetDeferred'){errorMessage=error.message;break;}}
   }
   pending.push(...retry); // Failed attempts rotate behind every still-unattempted current row.
   retryUrls=[...new Set([...(previous.navareaRetry||[]).filter(url=>pending.includes(url)),...retry])];
   pendingRows=pendingRows.filter(row=>pending.includes(row.url)||deferred.includes(row.url));
  }else{
   phase='listing-parse';const parsed=navareaPage(listing.body,source);validIndex=true;
   phase='warning-parse';for(const raw of parsed.warnings){const n=await parseNavareaWarning(raw,source,{now,bodyFetchedAt:listing.next.fetchedAt,sourceInForceAt:parsed.asOf});const old=items.find(x=>x.id===n.id);if(old)n.navareaEvidence.firstSeenAt=old.navareaEvidence.firstSeenAt;archiveOld(n);listed.add(n.id);incoming.push(n);}
   await commitResource(listing.url,listing.next);if(listing.changed)newBodies+=incoming.length;pending=[];pendingRows=[];retryUrls=[];deferred=[];
  }
 }catch(error){failedAttempt();failed++;errorMessage=error instanceof Error?error.message:'NAVAREA acquisition failed';if(error instanceof SourceStop)backoff=error.backoff;if(!validIndex){pending=[...(previous.navareaPending||[])];pendingRows=[...(previous.navareaPendingRows||[])];retryUrls=[...(previous.navareaRetry||[])];deferred=[...(previous.navareaDeferred||[])];}}
 // One bounded warning per failed collection attempt that reached transport.
 // Backoff/disabled/capacity early returns and successful passes never log.
 // Logging cannot alter collection, retention, admission or retry semantics.
 if(diagnostic&&requestsStarted){try{console.warn(JSON.stringify({event:'navarea-collection-diagnostic',sourceId:source.id,...publicNavareaDiagnostic(diagnostic)}));}catch{/* Keep collection independent from diagnostics. */}}
 const result=validIndex?reconcileNavarea([...items,...incoming],listed,now):items;
 const next:NavareaRecord={...previous,items:result,navareaCache:cache,navareaCacheVersions:cacheVersions,navareaVersions:versions,navareaPending:pending,navareaPendingRows:pendingRows,navareaRetry:retryUrls,navareaDeferred:deferred,navareaBackoff:backoff,navareaCapacityDeferred:false,revision:2,status:{...source,...(diagnostic?{navareaDiagnostic:diagnostic}:{}),state:errorMessage?'error':failed||pending.length||deferred.length?'partial':'ok',checkedAt:now,fetchedAt:newBodies?now:previous.status.fetchedAt,count:result.length,pages,detail:errorMessage?diagnostic?.code==='BODY_LIMIT'?'NAVAREA body exceeds reserved bytes。保存原文を保持し、取得失敗を警報0件とは扱いません。':'NAVAREA取得未確認。原文を保持。':`NAVAREA本文取得${newBodies}件、保留${pending.length}件・範囲外/識別未確認${deferred.length}件。履歴と沿岸警報の網羅性は未確認。`}};
 return cappedResult(previous,next);
}

/** Offline reuse only. Existing original stays internal and is never stamped as a new fetch. */
export async function reuseJcgSnapshot(html:string,url:string,verifiedAt:number):Promise<NavareaNotice>{
 const n=parseJcgDetail(html,url);return {...n,navareaEvidence:{schemaVersion:2,parserVersion:2,navarea:'XI',warningIdentity:canonicalWarningNumber(n.id)||n.id,contentVersion:await hash(n.text),sourceInForceAt:null,observedInCurrentList:null,publishedAt:n.issued,publishedAtKind:'website-posting-hour',bodyFetchedAt:null,firstSeenAt:verifiedAt,checkedAt:verifiedAt,selfCancelAt:null,selfCancelImmediately:false,cancels:[],cancellationEffects:[],cancellationUncertain:true,activityComplete:false,geometryUncertain:false,kind:'warning',clearanceNm:null,historyState:'prior-snapshot-only'},warnings:[...n.warnings,'取得済み過去スナップショット。現在の在効確認は未実施。']};
}

const finiteTimestamp=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const optionalTimestamp=(v:unknown)=>v===null||finiteTimestamp(v);
const validWarningId=(v:unknown)=>typeof v==='string'&&/^NAVAREA [IVX]+ \d{1,5}\/20\d{2}$/.test(v)&&canonicalWarningNumber(v)===v;
function validPublicEvidence(value:unknown):value is NavareaEvidence{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const e=value as Record<string,unknown>;
 if(e.schemaVersion!==2||e.parserVersion!==2||typeof e.navarea!=='string'||!['X','XIV','IX'].includes(e.navarea)||!validWarningId(e.warningIdentity)||typeof e.contentVersion!=='string'||!/^[a-f0-9]{64}$/.test(e.contentVersion))return false;
 if(typeof e.publishedAtKind!=='string'||!['broadcast-dtg','website-posting-hour','unknown'].includes(e.publishedAtKind)||typeof e.kind!=='string'||!['warning','in-force-summary','cancellation'].includes(e.kind)||typeof e.historyState!=='string'||!['current-publisher-snapshot','prior-snapshot-only'].includes(e.historyState))return false;
 if(!['sourceInForceAt','publishedAt','bodyFetchedAt','selfCancelAt'].every(k=>optionalTimestamp(e[k]))||!['firstSeenAt','checkedAt'].every(k=>finiteTimestamp(e[k])))return false;
 if(e.observedInCurrentList!==null&&typeof e.observedInCurrentList!=='boolean'||!['selfCancelImmediately','cancellationUncertain','activityComplete','geometryUncertain'].every(k=>typeof e[k]==='boolean'))return false;
 if(e.clearanceNm!==null&&!(typeof e.clearanceNm==='number'&&Number.isFinite(e.clearanceNm)&&e.clearanceNm>=0))return false;
 if(!Array.isArray(e.cancels)||e.cancels.length>128||!e.cancels.every(validWarningId)||!Array.isArray(e.cancellationEffects)||e.cancellationEffects.length>128)return false;
 return e.cancellationEffects.every(v=>{if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as Record<string,unknown>;return validWarningId(x.targetId)&&typeof x.self==='boolean'&&optionalTimestamp(x.effectiveAt)&&typeof x.uncertain==='boolean'&&typeof x.conditional==='boolean'&&typeof x.basis==='string'&&['issue-dtg','explicit-utc','unknown'].includes(x.basis);});
}
export type PublicNavareaNotice=Notice&{sourceId:string;publicProjection:'facts-only';navareaEvidence:NavareaEvidence};
/** Explicit allowlist: never spread internal Notice/raw text/cache/attachments into public output. */
export function projectNavareaPublicNotice(n:NavareaNotice):PublicNavareaNotice|null{
 if(!n||typeof n!=='object'||!validPublicEvidence(n.navareaEvidence)||!Array.isArray(n.shapes)||n.validityPeriods!=null&&(!Array.isArray(n.validityPeriods)||n.validityPeriods.some(p=>!p||!finiteTimestamp(p.start)||!finiteTimestamp(p.end)||p.end<=p.start))||!optionalTimestamp(n.issued)||!optionalTimestamp(n.start)||!optionalTimestamp(n.end)||typeof n.timeUncertain!=='boolean'||typeof n.lifecycleUncertain!=='boolean'||typeof n.cancelled!=='boolean'||!['hazard','firing','training','drone','other'].includes(n.purpose))return null;
 const ev=n.navareaEvidence;if(canonicalWarningNumber(n.id)!==ev.warningIdentity)return null;const source=navareaSources.find(s=>REGIONS[s.id]===ev.navarea);if(!source||ev.schemaVersion!==2||ev.parserVersion!==2||!/^NAVAREA (X|XIV|IX) \d{1,5}\/20\d{2}$/.test(ev.warningIdentity)||canonicalWarningNumber(ev.warningIdentity)!==ev.warningIdentity||!ev.warningIdentity.startsWith('NAVAREA '+ev.navarea+' ')||!/^[a-f0-9]{64}$/.test(ev.contentVersion))return null;
 const sourceUrl=n.sourceUrl&&allowedUrl(n.sourceUrl,source)?n.sourceUrl:source.url;
 const publicHazard=n.cancelled!==true&&ev.kind==='warning';
 const periods=(publicHazard?n.validityPeriods||[]:[]).filter(p=>p&&typeof p==='object'&&Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start).map(p=>({start:p.start,end:p.end}));
 const publicShapes:Shape[]=!publicHazard?[]:n.shapes.filter(s=>s&&typeof s==='object'&&['polygon','line','point'].includes(s.kind)&&Array.isArray(s.points)&&s.points.every(p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180)).map(s=>({kind:s.kind,points:s.points.map(p=>[p[0],p[1]]),provenance:'text',...(s.inferredClose?{inferredClose:true}:{}),...(s.approx===true||ev.geometryUncertain?{approx:true}:{}),...(s.partialBoundary===true||ev.geometryUncertain?{partialBoundary:true}:{})}));
 const evidence:NavareaEvidence={schemaVersion:2,parserVersion:2,navarea:ev.navarea,warningIdentity:ev.warningIdentity,contentVersion:ev.contentVersion,sourceInForceAt:ev.sourceInForceAt,observedInCurrentList:ev.observedInCurrentList,publishedAt:ev.publishedAt,publishedAtKind:ev.publishedAtKind,bodyFetchedAt:ev.bodyFetchedAt,firstSeenAt:ev.firstSeenAt,checkedAt:ev.checkedAt,selfCancelAt:ev.selfCancelAt,selfCancelImmediately:ev.selfCancelImmediately,cancels:[...ev.cancels],cancellationEffects:ev.cancellationEffects.map(e=>({targetId:e.targetId,self:e.self,effectiveAt:e.effectiveAt,uncertain:e.uncertain,conditional:e.conditional,basis:e.basis})),cancellationUncertain:ev.cancellationUncertain,activityComplete:publicHazard&&ev.activityComplete,geometryUncertain:ev.geometryUncertain,kind:ev.kind,clearanceNm:ev.clearanceNm,historyState:ev.historyState};
 const warnings=['公式原文から抽出した識別情報・日時・座標です。原文は発表元のリンクで確認してください。','公開Web情報は正式な安全放送の代替ではありません。'];
 if(n.timeUncertain)warnings.push('活動日程の全部または一部が未確認です。');if(ev.cancellationUncertain)warnings.push('将来または条件付きの取消は未適用です。');if(ev.geometryUncertain)warnings.push('区域の対応が未確定な座標があります。');
 return {id:ev.warningIdentity,location:`NAVAREA ${ev.navarea}`,text:`${ev.warningIdentity}\n${ev.kind==='cancellation'?'取消に関する情報':ev.kind==='in-force-summary'?'在効番号一覧':'航行警報'}。詳しい内容は公式原文を確認してください。`,issued:n.issued,start:publicHazard?n.start:null,end:publicHazard?n.end:null,permanent:false,purpose:n.purpose,shapes:publicShapes,warnings,sourceUrl,sourceName:source.name,sourceCountry:source.country,sourceId:source.id,publicProjection:'facts-only',validityPeriods:periods,timeUncertain:publicHazard?n.timeUncertain:false,lifecycleUncertain:n.lifecycleUncertain,cancelled:n.cancelled,maritimeTimeBasis:{zone:'UTC',disclosure:'原文に明記されたUTC時刻の抽出値。',sourceUrl},navareaEvidence:evidence};
}
export function projectNavareaPublicRecord(record:NavareaRecord){
 if(!record||!record.status||!Array.isArray(record.items))return null;
 const source=navareaSources.find(s=>s.id===record.status.id);if(!source)return null;
 const items=(record.items as NavareaNotice[]).map(projectNavareaPublicNotice).filter((n):n is PublicNavareaNotice=>n!==null);
 const rejected=record.items.length-items.length,state=rejected?(record.status.state==='error'?'error':'partial'):record.status.state;
 const diagnostic=publicNavareaDiagnostic(record.status.navareaDiagnostic);
 const detail=rejected?`公開形式を確認できない${rejected}件は原文を内部保持し公開を保留。警報なしとは判定しません。`:diagnostic?`取得診断: ${diagnostic.code}（${diagnostic.phase}${diagnostic.httpStatus===null?'':`, HTTP ${diagnostic.httpStatus}`}）。保存原文を保持し、取得失敗を警報0件とは扱いません。`:state==='error'?'NAVAREA取得を確認できません。保存原文を保持。警報0件とは扱いません。':'公式原文由来の識別情報・日時・座標のみ。取得範囲は限定的です。';
 return {items,status:{...source,state,checkedAt:record.status.checkedAt,fetchedAt:record.status.fetchedAt,count:items.length,pages:record.status.pages,detail,...(diagnostic?{navareaDiagnostic:diagnostic}:{})},publicProjection:'facts-only' as const};
}
