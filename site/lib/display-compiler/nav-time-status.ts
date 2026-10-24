import {memoizeNoticeAnalysis} from './ui-performance.mjs';
import type {Notice} from './notam';
import {noticeNavPeriods,navPeriodAnalysis} from './nav-period';
import {chinaMaritimeTimeFacts,chinaMaritimeCalendarValidity} from './nav-time-evidence';
import {internationalTimeEvidence,koreaSourceSchedule,type KoreaTimeBasis} from './nav-international-time-evidence';
type DisplayPeriod={start:number;end:number;precision?:"date"|"mixed";startPrecision?:"date"|"time";endPrecision?:"date"|"time";scopeLabel?:string;provenance?:string};
type ValidityPeriod=DisplayPeriod&{raw:string;timeZone:'Asia/Shanghai';provenance:'published-calendar-envelope'|'published-immediate-envelope'};
export type MaritimeTimeStatus={label:string;requiresReview:boolean;details:string[];periods:DisplayPeriod[];timeZoneEvidence?:KoreaTimeBasis;validityPeriods?:ValidityPeriod[];validityComplete?:boolean;timeBasis?:'validity-fallback';activityUncertain?:boolean};
const fmt=(n:number)=>new Date(n).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const date=(n:number)=>new Date(n).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric'});
const clock=(n:number)=>new Date(n).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false,hour:'2-digit',minute:'2-digit'});
export function maritimePeriodSummary(input:DisplayPeriod[]):string[]{
 const p=[...new Map(input.map(p=>[`${p.start}/${p.end}/${p.scopeLabel||""}`,p])).values()].sort((a,b)=>a.start-b.start||a.end-b.end);if(!p.length)return [];
 const coarse=p.filter(x=>x.precision),exact=p.filter(x=>!x.precision);
 if(coarse.length){const localDate=(t:number)=>new Date(t).toLocaleDateString('ja-JP',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric'});return [...coarse.slice(0,2).map(x=>`${x.scopeLabel||'期間'}：${x.startPrecision==='time'?fmt(x.start)+'（日本時間）':localDate(x.start)}〜${x.endPrecision==='time'?fmt(x.end)+'（日本時間）':localDate(x.end-1)}（${x.provenance==='explicit-all-day-body'?'原文に終日実施の記載あり':'日付のみのため終日扱い'}・中国標準時の日付の00:00〜終了日24:00）`),...(coarse.length>2?[`ほか${coarse.length-2}期間は本文に記載。`]:[]),...maritimePeriodSummary(exact)];}
 const labels=[...new Set(p.map(x=>x.scopeLabel||''))];
 if(labels.length>1)return labels.flatMap(label=>maritimePeriodSummary(p.filter(x=>(x.scopeLabel||'')===label)));
 const scope=labels[0]?labels[0]+'：':'';
 if(p.length===1)return [`${scope}${fmt(p[0].start)} 〜 ${fmt(p[0].end)}（日本時間）`];
 const duration=p[0].end-p[0].start;
 if(duration<=86400000 && p.every(x=>clock(x.start)===clock(p[0].start)&&x.end-x.start===duration)){
  const daily=p.every((x,i)=>i===0||x.start-p[i-1].start===86400000);
  const overnight=date(p[0].start)!==date(p[0].end)?'翌日':'';
  return [`${scope}${date(p[0].start)} 〜 ${date(p.at(-1)!.start)} ${daily?'毎日':`指定${p.length}日`} ${clock(p[0].start)}〜${overnight}${clock(p[0].end)}（日本時間）`,...(!daily?['対象日は本文に記載。期間中ずっと実施する意味ではありません。']:[])];
 }
 return [...p.slice(0,2).map(x=>`${scope}${fmt(x.start)} 〜 ${fmt(x.end)}（日本時間）`),...(p.length>2?[`ほか${p.length-2}区間。日ごとの時刻は本文を確認してください。`]:[])];
}
// These are enclosing published calendar bounds, never continuous activity.
// Keep parsing in the compiler: the visitor only compares verified timestamps.
export function maritimeValidityPeriods(n:Notice):{periods:ValidityPeriod[];complete:boolean}{
 if(n.cancelled||n.lifecycleUncertain||n.sourceCountry!=='CN'||n.maritimeAttachment?.status==='fetch-error')return {periods:[],complete:false};
 const normalize=(t:string)=>t.normalize('NFKC').replace(/&(?:ldquo|rdquo|quot|nbsp);/g,'').replace(/\s+/g,'').replace(/時/g,'时').replace(/[-—–－~～到]/g,'至');
 const text=normalize(n.text).split(/发布方式|發布方式|播发时间|播發時間/)[0];
 // An explicit different/unknown zone must never inherit China's local clock.
 if(/UTC|GMT|世界时|世界時|日本时间|日本時間|韩国时间|韓国時間|当地时间|當地時間/i.test(text))return {periods:[],complete:false};
 const out:ValidityPeriod[]=[],covered:string[]=[];
 const active=noticeNavPeriods(n) as (DisplayPeriod&{text?:string})[];
 const activity=/射击|射擊|训练|訓練|演习|演習|作业|作業|施工|活动|活動|管制|拖航|调查|調查|检验|檢驗|试验|試驗/;
 const stamp=/((?:20\d{2}年)?\d{1,2}月\d{1,2}日)(?:(\d{1,4}时(?:\d{1,2}分)?|\d{1,2}:\d{2}))?至((?:20\d{2}年)?(?:\d{1,2}月)?\d{1,2}日)(?:(\d{1,4}时(?:\d{1,2}分)?|\d{1,2}:\d{2}))?/g;
 const validClock=(raw:string|undefined)=>{if(!raw)return true;const m=raw.match(/^(\d{1,4})(?:时(?:(\d{1,2})分)?|:(\d{2}))$/);if(!m)return false;const h=m[2]!==undefined||m[3]!==undefined||m[1].length<=2?+m[1]:Math.floor(+m[1]/100),min=m[2]!==undefined||m[3]!==undefined?+(m[2]||m[3]):m[1].length<=2?0:+m[1]%100;return h<=24&&min<60&&(h!==24||min===0);};
 for(const clause of text.split(/[。；;]/)){
  if(!activity.test(clause))continue;
  for(const m of clause.matchAll(stamp)){
   const before=clause.slice(0,m.index),after=clause.slice(m.index!+m[0].length);
   // Publication, cancellation, an incident and a prior-notice quotation do not
   // define the current activity's enclosing period.
   if(/据报|據報|落水|失踪|失蹤|沉没|沉沒|原通告|原航警|原定|原计划|原計劃|延期|延长|延長/.test(clause)||/发布|發布|播发|播發|撤销|撤銷|取消/.test(before.slice(-30))||/^(?:[^，,:：]{0,8})?(?:撤销|撤銷|取消)/.test(after))continue;
   if(!validClock(m[2])||!validClock(m[4]))continue;
   if(active.some(p=>!p.precision&&normalize(p.text||'').includes(normalize(m[0]))))continue;
   // A clock immediately following the last date can belong to a shared
   // daily pair, not that date's end bound (e.g. Aug5-Aug12 08h-18h).
   const shared=m[4]&&!m[2]?after.match(/^至(\d{1,4}时(?:\d{1,2}分)?|\d{1,2}:\d{2})/):null;
   if(shared&&!validClock(shared[1]))continue;
   const minutes=(raw:string)=>{const x=raw.match(/^(\d{1,4})(?:时(?:(\d{1,2})分)?|:(\d{2}))$/)!;return (x[2]!==undefined||x[3]!==undefined||x[1].length<=2?+x[1]:Math.floor(+x[1]/100))*60+(x[2]!==undefined||x[3]!==undefined?+(x[2]||x[3]):x[1].length<=2?0:+x[1]%100);};
   // The established CN date parser supplies calendar/year context. Preserve
   // every clock that actually qualifies an endpoint; never round it outward.
   const parsed=navPeriodAnalysis(m[1]+'至'+m[3],n.issued).periods;
   for(const p of parsed){
    const start=m[2]?p.start+minutes(m[2])*60000:p.start,end=m[4]&&!shared?p.end-86400000+minutes(m[4])*60000:p.end;
    if(end<=start)continue;
    out.push({...p,...(/作业时间|作業時間|施工时间|施工時間/.test(before)?{scopeLabel:'作業'}:{}),start,end,startPrecision:m[2]?'time':'date',endPrecision:m[4]&&!shared?'time':'date',raw:m[0]+(shared?shared[0]:''),timeZone:'Asia/Shanghai',provenance:'published-calendar-envelope'});
   }
   if(parsed.length)covered.push(normalize(m[1]+'至'+m[3]));
  }
 }
 // Existing calendar evidence already excludes departures, observations,
 // lifecycle dates and unsupported zones. Keep listed days as separate bounds.
 const calendar=chinaMaritimeCalendarValidity(n);
 for(const p of calendar){out.push({...p,startPrecision:'date',endPrecision:'date',raw:p.raw,timeZone:'Asia/Shanghai',provenance:'published-calendar-envelope'});covered.push(normalize(p.raw));}
 // Recover explicit immediate bounds from the original even when acquisition
 // has correctly removed mixed-precision activity intervals from its API row.
 if(n.issued!==null&&Number.isFinite(n.issued))for(const clause of text.split(/[。；;]/)){
  if(!activity.test(clause)||/原通告|原航警|原定|原计划|原計劃|延期|延长|延長/.test(clause))continue;
  for(const m of clause.matchAll(/即日起至((?:20\d{2}年)?\d{1,2}月\d{1,2}日(?:\d{1,4}时(?:\d{1,2}分)?|\d{1,2}:\d{2}))/g)){
   const before=clause.slice(0,m.index),after=clause.slice(m.index!+m[0].length);
   if(/发布|發布|撤销|撤銷|取消/.test(before.slice(-12))||/^(?:\d|至|[:：])/.test(after))continue;
   const facts=chinaMaritimeTimeFacts({...n,text:'活动时间：'+m[1]});
   if(facts.length!==1||facts[0].raw!==m[1]||facts[0].instant===null||facts[0].instant<=n.issued)continue;
   out.push({start:n.issued,end:facts[0].instant,startPrecision:'time',endPrecision:'time',raw:m[0],timeZone:'Asia/Shanghai',provenance:'published-immediate-envelope'});covered.push(normalize(m[0]));
  }
 }
 // “Effective immediately” is explicit source authority to use its issue time.
 // Do not use publication timestamps for any other notice.
 for(const p of (n.validityPeriods||[]) as (DisplayPeriod&{text?:string})[]){
  if(!p.text||!normalize(p.text).includes('即日起至')||!text.includes(normalize(p.text))||!Number.isFinite(n.issued)||p.start!==n.issued||!Number.isFinite(p.end)||p.end<=p.start)continue;
  if(!chinaMaritimeTimeFacts({...n,text:'活动时间：'+p.text}).some(f=>f.instant===p.end))continue;
  out.push({...p,raw:p.text,startPrecision:'time',timeZone:'Asia/Shanghai',provenance:'published-immediate-envelope'});covered.push(normalize(p.text));
 }
 const periods=[...new Map(out.map(p=>[`${p.start}/${p.end}`,p])).values()].sort((a,b)=>a.start-b.start||a.end-b.end);
 for(const m of text.matchAll(/(?:20\d{2}年)?\d{1,2}月\d{1,2}日(?:[、,，和及]\d{1,2}日)+/g)){
  const dates=[...m[0].matchAll(/\d{1,2}日/g)].map(x=>x[0]);
  if(calendar.length===dates.length&&dates.every(d=>calendar.some(p=>p.raw.endsWith(d))))covered.push(normalize(m[0]));
 }
 const unresolved=navPeriodAnalysis(n.text,n.issued).unparsedClauses;
 const complete=periods.length>0&&unresolved.every(clause=>{
  if(clause==='本文の明示時刻・時刻欠落があるため日付だけの終日範囲を適用していません')return true;
  // A hydrological comparison explains the restriction; its observation and
  // forecast clocks are not additional restriction windows. Do not ignore a
  // mixed clause that also contains an activity or restriction.
  const forecast=normalize(clause).replace(/^[^,，]*航警\d+\/\d+[,，]/,'');
  if(/^据上游水文局水情预报[,，][\u4e00-\u9fff]{1,10}站\d{1,2}月\d{1,2}日\d{4}时预报水位较\d{1,2}月\d{1,2}日\d{4}时水位(?:下降|上涨|上升)\d+(?:\.\d+)?米$/.test(forecast))return true;
  let rest=normalize(clause),matched=false;
  for(const raw of [...covered].sort((a,b)=>b.length-a.length))if(rest.includes(raw)){rest=rest.replace(raw,'');matched=true;}
  // Unmatched additional days or instants must not disappear behind one span.
  return matched&&!/\d{1,2}月\d{1,2}日|\d{1,2}日(?:\d|至|[、,，和及])|即日起|另行通知|另告/.test(rest);
 });
 return {periods,complete};
}
function maritimeValiditySummary(periods:ValidityPeriod[]):string[]{
 const local=(t:number)=>new Date(t).toLocaleDateString('ja-JP',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric'});
 return periods.slice(0,4).map(p=>(p.scopeLabel?p.scopeLabel+'：':'')+(p.provenance==='published-immediate-envelope'?`${fmt(p.start)} 〜 ${fmt(p.end)}（日本時間）`:`${local(p.start)} 〜 ${local(p.end-1)}（中国標準時の日付）`));
}
export const maritimeTimeStatus: (n:Notice)=>MaritimeTimeStatus = memoizeNoticeAnalysis(function maritimeTimeStatusUncached(n:Notice):MaritimeTimeStatus{
 const empty={periods:[] as {start:number;end:number}[]};
 if(n.cancelled)return {...empty,label:'取消・終了',requiresReview:false,details:[]};
 const korean=n.sourceCountry==='KR'?koreaSourceSchedule(n):null;
 const periods:DisplayPeriod[]=(korean?korean.periods:noticeNavPeriods(n)).filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start);
 const timeZoneEvidence=korean?.basis;
 const cn=!n.sourceCountry||n.sourceCountry==='CN';
 const retainedMirror=n.sourceCountry==='KR'&&n.warnings.some(w=>w.startsWith('最新のGICOMS応答'));
 const partial=Boolean(n.timeUncertain)||n.maritimeAttachment?.status==='fetch-error'||(cn&&navPeriodAnalysis(n.text,n.issued).unparsedClauses.length>0);
 const validity=partial||!periods.length?maritimeValidityPeriods(n):{periods:[],complete:false};
 if(validity.periods.length)return {periods,validityPeriods:validity.periods,validityComplete:validity.complete,timeBasis:'validity-fallback',activityUncertain:true,label:'期間',requiresReview:true,details:[...maritimeValiditySummary(validity.periods),...maritimePeriodSummary(periods)]};
 if(periods.length)return {periods,...(timeZoneEvidence?{timeZoneEvidence}:{}),label:retainedMirror?'保存日程あり・原文再確認が必要':timeZoneEvidence?`実施時間あり（${timeZoneEvidence.zone==='Asia/Seoul'?'韓国時間':timeZoneEvidence.zone==='Asia/Tokyo'?'日本時間':timeZoneEvidence.disclosure}）`:n.maritimeAttachment?.status==='fetch-error'?'保存日程あり・再取得に失敗':partial?'実施時間あり・一部確認が必要':periods.some(p=>p.provenance==='user-date-only-fallback')?'日付のみのため終日扱い':periods.some(p=>p.provenance==='explicit-all-day-body')?'原文に終日実施の記載あり':'実施時間を確認済み',requiresReview:partial,details:[...maritimePeriodSummary(periods),...(timeZoneEvidence?[timeZoneEvidence.disclosure]:[]),...(retainedMirror?['最新の応答で時間表が欠けたため、前回取得した日時を表示しています。']:[]),...(n.maritimeAttachment?.status==='fetch-error'?['原文の再取得に失敗したため、前回保存した日程です。']:partial?['追加の日程・条件は本文を確認してください。']:[])]};
 const international=internationalTimeEvidence(n);
 const facts=chinaMaritimeTimeFacts({...n,sourceCountry:n.sourceCountry||'CN'});
 const calendar=chinaMaritimeCalendarValidity({...n,sourceCountry:n.sourceCountry||'CN'});
 if(calendar.length)return {...empty,label:'日付のみ・実施時刻未記載',requiresReview:true,details:[...calendar.slice(0,4).map(f=>f.raw+'（中国標準時の日付）'),'実施時刻は本文に記載がありません。終日実施とは判断していません。']};
 if(n.start!==null&&n.end===null)return {...empty,label:'開始日時あり・終了未確定',requiresReview:true,details:[`開始：${fmt(n.start)}（日本時間）。終了は未確定です。`]};
 if(n.end!==null&&n.start===null)return {...empty,label:'終了日時あり・開始未確定',requiresReview:true,details:[`終了：${fmt(n.end)}（日本時間）。開始は未確定です。`,...(/\bIN PROGRESS\b/i.test(n.text)?['原文には「実施中」と記載されています。']:[])]};
 if(facts.some(f=>f.instant!==null))return {...empty,label:'原文日時あり・期間未確定',requiresReview:true,details:[...facts.filter(f=>f.instant!==null).slice(0,3).map(f=>`原文日時：${fmt(f.instant!)}（日本時間）`),'出港・事故等の日時と、警告の有効期間は区別しています。',...facts.flatMap(f=>f.warning?[f.warning]:[])]};
 if(n.sourceCountry==='TW'){
  const a=n.maritimeAttachment;
  const label=a?.status==='fetch-error'?'添付原文の取得失敗':a?.status==='unsupported'?'添付様式が未対応':a?.status==='fulltext-retained'?'原文取得済み・日時の読取り未対応':'添付原文が未取得';
  return {...empty,label,requiresReview:true,details:international?[international.display.replace(/時区/g,'タイムゾーン'),label+'。添付原文の実施時刻を確認する必要があります。']:[label+'。掲載日を実施日に置き換えていません。']};
 }
 if(international)return {...empty,label:international.kind==='source-clock'?(international.timezone==='unverified'?'原文日時あり・時刻の対応要確認':'原文日時あり・実施条件要確認'):international.kind==='calendar-only'?'原文日程あり・時刻未確定':international.kind==='open-ended'?'終了は追って通知・期間未確定':'日程の一部が未確定',requiresReview:true,details:[international.display.replace(/時区/g,'タイムゾーン'),international.caution.replace(/時区/g,'タイムゾーン')]};
 if(facts.length)return {...empty,label:'原文日付あり・実施時刻未確定',requiresReview:true,details:[...facts.slice(0,3).map(f=>f.raw),...facts.flatMap(f=>f.warning?[f.warning]:[]),'日付の記載はありますが、実施期間の始まりと終わりを確定できません。']};
 return {...empty,label:'実施期間を確認できません',requiresReview:true,details:['原文に十分な日時情報がないか、未対応の書式です。']};
});
