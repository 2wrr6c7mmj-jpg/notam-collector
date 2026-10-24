import type {Notice} from './notam';
import {noticeNavPeriods,navPeriodAnalysis} from './nav-period';
import {chinaMaritimeTimeFacts,chinaMaritimeCalendarValidity} from './nav-time-evidence';
import {internationalTimeEvidence,koreaSourceSchedule,type KoreaTimeBasis} from './nav-international-time-evidence';
type DisplayPeriod={start:number;end:number;precision?:"date"|"mixed";startPrecision?:"date"|"time";endPrecision?:"date"|"time";scopeLabel?:string};
export type MaritimeTimeStatus={label:string;requiresReview:boolean;details:string[];periods:DisplayPeriod[]};
const fmt=(n:number)=>new Date(n).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const date=(n:number)=>new Date(n).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric'});
const clock=(n:number)=>new Date(n).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false,hour:'2-digit',minute:'2-digit'});
export function maritimePeriodSummary(input:DisplayPeriod[]):string[]{
 const p=[...new Map(input.map(p=>[`${p.start}/${p.end}/${p.scopeLabel||""}`,p])).values()].sort((a,b)=>a.start-b.start||a.end-b.end);if(!p.length)return [];
 const coarse=p.filter(x=>x.precision),exact=p.filter(x=>!x.precision);
 if(coarse.length){const localDate=(t:number)=>new Date(t).toLocaleDateString('ja-JP',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric'});return [...coarse.slice(0,2).map(x=>`${x.scopeLabel||'期間'}：${x.startPrecision==='time'?fmt(x.start)+'（日本時間）':localDate(x.start)}〜${x.endPrecision==='time'?fmt(x.end)+'（日本時間）':localDate(x.end-1)}（日付の原文は中国標準時。時刻未記載の部分あり）`),...(coarse.length>2?[`ほか${coarse.length-2}期間は本文に記載。`]:[]),...maritimePeriodSummary(exact)];}
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
export function maritimeTimeStatus(n:Notice):MaritimeTimeStatus{
 const empty={periods:[] as {start:number;end:number}[]};
 if(n.cancelled)return {...empty,label:'取消・終了',requiresReview:false,details:[]};
 const korean=n.sourceCountry==='KR'?koreaSourceSchedule(n):null;
 const periods:DisplayPeriod[]=(korean?korean.periods:noticeNavPeriods(n)).filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start);
 const timeZoneEvidence=korean?.basis;
 const cn=!n.sourceCountry||n.sourceCountry==='CN';
 const retainedMirror=n.sourceCountry==='KR'&&n.warnings.some(w=>w.startsWith('最新のGICOMS応答'));
 const partial=Boolean(n.timeUncertain)||n.maritimeAttachment?.status==='fetch-error'||(cn&&navPeriodAnalysis(n.text,n.issued).unparsedClauses.length>0);
 if(periods.length)return {periods,...(timeZoneEvidence?{timeZoneEvidence}:{}),label:retainedMirror?'保存日程あり・原文再確認が必要':timeZoneEvidence?`実施時間あり（${timeZoneEvidence.zone==='Asia/Seoul'?'韓国時間':timeZoneEvidence.zone==='Asia/Tokyo'?'日本時間':timeZoneEvidence.disclosure}）`:n.maritimeAttachment?.status==='fetch-error'?'保存日程あり・再取得に失敗':partial?'実施時間あり・一部確認が必要':periods.some(p=>p.precision)?'期間を確認済み（日付単位を含む）':'実施時間を確認済み',requiresReview:partial,details:[...maritimePeriodSummary(periods),...(timeZoneEvidence?[timeZoneEvidence.disclosure]:[]),...(retainedMirror?['最新の応答で時間表が欠けたため、前回取得した日時を表示しています。']:[]),...(n.maritimeAttachment?.status==='fetch-error'?['原文の再取得に失敗したため、前回保存した日程です。']:partial?['追加の日程・条件は本文を確認してください。']:[])]};
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
}
