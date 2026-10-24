import type {Notice,Shape} from './notam';
import type {NavSource} from './nav-sources';

type ObjectValue=Record<string,unknown>;
const object=(value:unknown):ObjectValue|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:null;
const select=(value:unknown,keys:readonly string[]):ObjectValue|undefined=>{const from=object(value);if(!from)return;return Object.fromEntries(keys.filter(k=>from[k]===null||typeof from[k]==='string'||typeof from[k]==='boolean'||typeof from[k]==='number'&&Number.isFinite(from[k])).map(k=>[k,from[k]]));};
const rows=(value:unknown,keys:readonly string[])=>Array.isArray(value)?value.map(v=>select(v,keys)).filter((v):v is ObjectValue=>!!v):[];
const strings=(value:unknown)=>Array.isArray(value)?value.filter((s):s is string=>typeof s==='string'&&s.length<=2000):[];
const timestamp=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&Math.abs(value)<=8640000000000000?value:null;
const safeUrl=(value:unknown)=>{if(typeof value!=='string')return undefined;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}};
const periodKeys=['start','end','precision','startPrecision','endPrecision','scopeLabel'];
function publicPeriod(p:NonNullable<Notice['validityPeriods']>[number]){
 if(!p||timestamp(p.start)===null||timestamp(p.end)===null||p.end<=p.start||Object.keys(p).some(k=>!periodKeys.includes(k)))return null;
 if(p.precision!==undefined&&!['date','mixed'].includes(p.precision)||p.startPrecision!==undefined&&!['date','time'].includes(p.startPrecision)||p.endPrecision!==undefined&&!['date','time'].includes(p.endPrecision)||p.scopeLabel!==undefined&&(typeof p.scopeLabel!=='string'||p.scopeLabel.length>256))return null;
 return {start:p.start,end:p.end,...(p.precision?{precision:p.precision}:{}),...(p.startPrecision?{startPrecision:p.startPrecision}:{}),...(p.endPrecision?{endPrecision:p.endPrecision}:{}),...(p.scopeLabel?{scopeLabel:p.scopeLabel}:{})};
}
function publicShape(value:Shape):Shape|null {
 const allowed=['kind','points','radius','approx','inferredClose','provenance','holes','interpolated','partialBoundary','referenceBoundary','sourceReference','sourceRow','validityPeriods','corridorHalfWidthMeters','reconstructedCorridor','coastlineApproximated'];
 if(!value||Object.keys(value).some(k=>!allowed.includes(k))||!['point','line','polygon','circle'].includes(value.kind)||!Array.isArray(value.points)||!value.points.length||!value.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180))return null;
 if(['point','circle'].includes(value.kind)&&value.points.length!==1||value.kind==='line'&&value.points.length<2||value.kind==='polygon'&&value.points.length<3)return null;
 if(value.provenance!==undefined&&!['provider','text','named'].includes(value.provenance))return null;
 if(value.kind==='circle'&&(!Number.isFinite(value.radius)||value.radius!<=0)||value.corridorHalfWidthMeters!==undefined&&(!Number.isFinite(value.corridorHalfWidthMeters)||value.corridorHalfWidthMeters<=0))return null;
 for(const key of ['approx','inferredClose','interpolated','partialBoundary','referenceBoundary','reconstructedCorridor','coastlineApproximated'] as const)if(value[key]!==undefined&&typeof value[key]!=='boolean')return null;
 if(value.holes!==undefined&&(!Array.isArray(value.holes)||value.holes.some(r=>!Array.isArray(r)||r.length<3||r.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180))))return null;
 if(value.validityPeriods!==undefined&&(!Array.isArray(value.validityPeriods)||value.validityPeriods.some(p=>!publicPeriod(p))))return null;
 if(value.sourceReference!==undefined&&(typeof value.sourceReference!=='string'||value.sourceReference.length>1024)||value.sourceRow!==undefined&&(typeof value.sourceRow!=='string'||value.sourceRow.length>256))return null;
 return {kind:value.kind,points:value.points.map(p=>[p[0],p[1]]),...select(value,['radius','approx','inferredClose','provenance','interpolated','partialBoundary','referenceBoundary','sourceReference','sourceRow','corridorHalfWidthMeters','reconstructedCorridor','coastlineApproximated']),...(value.holes?{holes:value.holes.map(r=>r.map(p=>[p[0],p[1]]))}:{}),...(value.validityPeriods?{validityPeriods:value.validityPeriods.map(p=>({start:p.start,end:p.end}))}:{})} as Shape;
}
export type PublicFactNotice=Notice&{sourceId:string;publicProjection:'facts-only';taiwan?:ObjectValue;navareaEvidence?:ObjectValue};
// Construct the public representation; never spread a private cached notice.
// Provider-specific projectors establish provenance; completeness may remain uncertain.
export function publicFactNotice(projected:Notice,source:NavSource):PublicFactNotice {
 const extra=projected as Notice&{taiwan?:unknown;navareaEvidence?:unknown};
 const geometry=(Array.isArray(projected.shapes)?projected.shapes:[]).map(publicShape),invalidGeometry=!Array.isArray(projected.shapes)||geometry.some(s=>s===null),shapes=geometry.filter((s):s is Shape=>s!==null);
 const allPeriods=Array.isArray(projected.validityPeriods)?projected.validityPeriods:[],periods=allPeriods.map(publicPeriod).filter((p):p is NonNullable<typeof p>=>p!==null);
 const invalidPeriods=projected.validityPeriods!==undefined&&!Array.isArray(projected.validityPeriods)||periods.length!==allPeriods.length||projected.start!==null&&projected.start!==undefined&&timestamp(projected.start)===null||projected.end!==null&&projected.end!==undefined&&timestamp(projected.end)===null;
 const unknownTaiwan=source.country==='TW'&&!object(extra.taiwan);
 const t=object(extra.taiwan)||(unknownTaiwan?{version:2,publisher:source.id==='tw-fisheries'?'FA':source.id==='tw-moa-ship'?'MOA':source.id==='tw-motc'?'MOTC':'MND',role:source.id.startsWith('tw-mnd-')?'primary':'supplement',bodyComplete:false,semanticComplete:false,documents:[],attachments:[],rights:{status:'unverified',url:source.url,detail:'旧形式の保存資料です。原文・添付の現在の検証証跡は未確認です。'},unresolved:['旧形式の保存資料。本文・全添付の再確認が必要です。']}:null),n=object(extra.navareaEvidence);
 const taiwan=t?{
  ...select(t,['version','publisher','role','bodyComplete','semanticComplete','issueReference','supersededBy','historyState']),
  publication:select(t.publication,['value','precision','evidence']),issue:select(t.issue,['value','precision','evidence']),
  documents:rows(t.documents,['url','requestedUrl','fetchedAt','status','bytes','sha256','mediaType','extraction','reason']),
  attachments:rows(t.attachments,['url','state','reason']),rights:select(t.rights,['status','url','detail']),unresolved:strings(t.unresolved),
  amendment:select(t.amendment,['kind','targetReference','evidence']),
 }:undefined;
 const navareaEvidence=n?{...select(n,['schemaVersion','parserVersion','navarea','warningIdentity','contentVersion','sourceInForceAt','observedInCurrentList','publishedAt','publishedAtKind','bodyFetchedAt','firstSeenAt','checkedAt','selfCancelAt','selfCancelImmediately','cancels','kind','clearanceNm','historyState','cancellationUncertain','activityComplete','geometryUncertain']),cancellationEffects:rows(n.cancellationEffects,['targetId','self','effectiveAt','uncertain','conditional','basis']),cancels:strings(n.cancels),observedInCurrentList:typeof n.observedInCurrentList==='boolean'?n.observedInCurrentList:null}:undefined;
 const administrative=!!n&&n.kind!=='warning',inactive=projected.cancelled===true||administrative||typeof t?.supersededBy==='string';
 return {id:typeof projected.id==='string'?projected.id:source.id+':unverified',location:typeof projected.location==='string'?projected.location:source.region,text:typeof projected.text==='string'?projected.text:'公開用の読取結果は未確認です。公式原文を確認してください。',sourceId:source.id,publicProjection:'facts-only',sourceCountry:source.country,sourceName:source.name,sourceUrl:safeUrl(projected.sourceUrl)||source.url,
  issued:unknownTaiwan?null:timestamp(projected.issued),start:invalidPeriods||inactive||unknownTaiwan?null:timestamp(projected.start),end:invalidPeriods||inactive||unknownTaiwan?null:timestamp(projected.end),permanent:projected.permanent===true,purpose:['hazard','firing','training','drone','other'].includes(projected.purpose)?projected.purpose:'other',
  shapes:inactive||unknownTaiwan?[]:shapes,validityPeriods:invalidPeriods||inactive||unknownTaiwan?[]:periods,cancelled:projected.cancelled===true,timeUncertain:projected.timeUncertain===true||invalidPeriods||unknownTaiwan,lifecycleUncertain:projected.lifecycleUncertain===true,
  warnings:[...strings(projected.warnings),...(invalidGeometry||invalidPeriods?['公開用の数値形式を検証できない部分は省略し、確認できた座標のみ保持しています。']:[])],
  ...(projected.maritimeTimeBasis?{maritimeTimeBasis:select(projected.maritimeTimeBasis,['zone','disclosure','sourceUrl','sourceDate','reviewRequired']) as Notice['maritimeTimeBasis']}:{}),...(projected.maritimeAttachment?{maritimeAttachment:select(projected.maritimeAttachment,['status','format','sourceUrl','checkedAt','bodyFetchedAt','textTruncated']) as Notice['maritimeAttachment']}:{}),...(taiwan?{taiwan}:{}),...(navareaEvidence?{navareaEvidence}:{})};
}
