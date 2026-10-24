import {parseMsilPublication} from '../shared/msil-publication.mjs';
import {msilListingState} from './msil-listing-state.mjs';
import {maritimeActivityPurpose} from '../shared/bombing-activity.mjs';
import {timeDisclosure} from './msil-time-disclosure.mjs';
import crypto from 'node:crypto';
import {parseMsilPeriods,msilPeriodsForShape} from './msil-periods.mjs';
import {verifiedTimeZoneOptions} from './msil-time-zone-proof.mjs';
import {verifyTextDuplicate} from './msil-relations.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message);};
const fmt=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false});
const reasonLabels={
 'year-not-established':'活動年を確定できません。',
 'time-zone-not-established':'原文のタイムゾーンを確定できません。',
 'conflicting-explicit-time-zones':'本文の時区指定が一致していません。',
 'unsupported-explicit-time-zone':'本文の現地時区に未確認の指定があります。',
 'area-specific-period-mapping-unresolved':'区域ごとの時刻と図形の対応が未確定です。',
 'holiday-calendar-unresolved':'祝日の除外条件を確認する必要があります。',
 'alternate-dates-require-review':'予備日があります。実施日は原文で確認してください。',
 'alternate-and-self-cancellation-require-review':'予備日と自動取消予定の記載を照合する必要があります。',
 'remaining-activity-time-needs-review':'本文に追加の日時条件が残っています。',
 'open-ended-without-bounded-period':'終了は追って通知など、終了日時が未確定です。',
 'start-not-established':'開始日時を確定できません。',
 'no-bounded-activity-period':'原文から活動の開始と終了を確定できません。',
 'observation-or-issue-time-only':'観測・発表時刻は活動期間に置き換えていません。',
};
// Literal primary and conditional schedules can be known even when selecting
// the actual reserve day is unresolved. This metadata never activates a reserve
// period, fills a gap, or constructs a warning-wide min/max envelope.
export function msilPeriodKnowledge(schedule){
 const bounded=p=>Number.isFinite(p?.start)&&Number.isFinite(p?.end)&&p.end>p.start;
 const conditionalReasons=new Set(['alternate-dates-require-review','source-alternate-calendar-conflict','alternate-and-self-cancellation-require-review']);
 return schedule.sourceSchedule?.kind==='bounded'&&schedule.completeness==='partial'&&
  schedule.periods?.length>0&&schedule.periods.every(bounded)&&
  schedule.alternatePeriods?.length>0&&schedule.alternatePeriods.every(p=>bounded(p)&&p.conditional===true)&&
  schedule.reasons?.length>0&&schedule.reasons.every(r=>conditionalReasons.has(r))
  ?'primary-and-conditional':undefined;
}
export function integrateMsil(maritime,msil){
 if(!msil?.items?.length)return maritime;
 const baseItems=maritime.items,mergedIndexes=new Set(),merges=[];
 const items=msil.items.map(source=>{
  const schedule=parseMsilPeriods(source,verifiedTimeZoneOptions(source,msil.items)),[warningSeries,warningNumber]=source.identity.split(':');
  let existing=null,proof=null,index=-1;
  if(source.match?.status==='verified-same-warning-text'){
   index=baseItems.findIndex(x=>x.id===source.match.existing.id);
   if(index>=0){const candidate=baseItems[index];const fresh=verifyTextDuplicate({...source,warningSeries,warningNumber},candidate);
    const valid=source.match.evidenceHashesMatch===true&&hash(source.text)===source.match.msilTextSHA256&&hash(candidate.text)===source.match.existingTextSHA256&&fresh.status==='verified-same-warning-text'&&fresh.msilCanonicalBodySHA256===source.match.canonicalBodySHA256;
    if(valid){assert(!mergedIndexes.has(index),'Two MSIL warnings claim the same source record');existing=candidate;proof={...fresh,applied:true,msilTextSHA256:hash(source.text),existingTextSHA256:hash(candidate.text)};mergedIndexes.add(index);merges.push({sourceIndex:index,sourceId:candidate.id,msilIdentity:source.identity,proof});}
   }
  }
  const originals=[{sourceName:'海しる / 海上保安庁',text:source.text,sourceLinks:source.sourceLinks,shapes:source.shapes,geometries:source.geometries},...(existing?[{sourceName:existing.sourceName||'海上保安庁 原文',text:existing.text,sourceLinks:[existing.sourceUrl],shapes:existing.shapes}]:[])];
  const shapes=originals.flatMap((o,sourceIndex)=>structuredClone(o.shapes).map(shape=>({...shape,sourceIndex,sourceReference:o.sourceName,...(schedule.geometryTimeMapping==='unresolved'?{timeMappingUncertain:true}:schedule.geometryTimeMapping==='verified-coordinate-match'?{validityPeriods:msilPeriodsForShape(schedule,shape)||[],timeMappingUncertain:!msilPeriodsForShape(schedule,shape)}:{})})));
  // Date-only source ranges establish a calendar envelope, not continuous
  // activity. Keep their original parse evidence, but never publish them as
  // exact activity windows. This applies regardless of how the zone was chosen.
  const evidencePeriods=schedule.periods.map(p=>({...p,text:p.raw}));
  const dateValidity=evidencePeriods.filter(p=>p.provenance==='user-date-only-fallback').map(p=>({...p,precision:'date',startPrecision:'date',endPrecision:'date',provenance:'source-date-only-calendar-envelope',sourceProvenance:p.provenance}));
  const periods=evidencePeriods.filter(p=>p.provenance!=='user-date-only-fallback'),knowledge=msilPeriodKnowledge(schedule);
  const validityPeriods=[...(schedule.validityPeriods||[]),...dateValidity];
  const validityComplete=dateValidity.length?schedule.completeness==='complete':schedule.validityComplete;
  const cancelled=schedule.cancellation.state==='cancelled',requiresReview=!cancelled&&schedule.completeness!=='complete';
  const disclosure=timeDisclosure(source,schedule),validity=validityPeriods.length?{validityPeriods,validityComplete,timeBasis:'validity-fallback',activityUncertain:true,...(dateValidity.length?{validityPrecision:'date'}:{})}:{},label=validityPeriods.length?'期間':disclosure.label;
  schedule.disclosure=disclosure;
  const details=[disclosure.detail,...schedule.openEndedPeriods.map(p=>`${fmt(p.start)}から、終了は追って通知（日本時間）。`),...periods.slice(0,3).map(p=>`${fmt(p.start)} ～ ${fmt(p.end)}（日本時間）`),...(periods.length>3?[`ほか${periods.length-3}区間。対象日と原文を下で確認できます。`]:[]),...schedule.reasons.map(r=>reasonLabels[r]||'未対応の日時条件があります。'),...(schedule.yearBasis?[`年は原文の掲載年${schedule.yearBasis.year}年を文脈として補っています。掲載日時を活動開始には使用していません。`]:[]),...(schedule.cancellation.selfScheduled.length?['自動取消予定を原文に記載。活動の終了時刻とは分けて表示しています。']:[]),...(schedule.cancellation.otherReferences.length?['別警報の取消参照があります。この警報自身の取消とは扱っていません。']:[])];
  return {sourceSchedule:schedule.sourceSchedule,sourceListing:msilListingState(source,msil.acquisition,msil.refreshState),id:existing?.id||source.identity,location:existing?.location||source.name,dataset:'maritime',text:source.text,sourceName:existing?'海上保安庁 / 海しる（本文一致）':'海しる / '+warningSeries,sourceUrl:source.sourceLinks[0],sourceCountry:'JP',issuerCountry:'JP',geographicRegion:null,countries:['JP'],...parseMsilPublication(source),start:evidencePeriods.length?Math.min(...evidencePeriods.map(p=>p.start)):null,end:evidencePeriods.length?Math.max(...evidencePeriods.map(p=>p.end)):null,permanent:false,cancelled,purpose:maritimeActivityPurpose(source.text,source.topic.verified?'firing':existing?.purpose||'other'),shapes,warnings:requiresReview?[label]:[],staticSchedule:{cancelled,periods,openEndedPeriods:schedule.openEndedPeriods,requiresReview,completeness:schedule.completeness,...validity,...(knowledge?{periodKnowledge:knowledge}:{})},detail:{label,requiresReview,periods,details},overview:{activity:source.name,requests:[]},msilIdentity:source.identity,periodEvidence:schedule,originals,mergeProof:proof,attribution:msil.attribution,constraintsUrl:msil.constraintsUrl};
 });
 const integration={schemaVersion:1,sourceCount:baseItems.length,msilCount:items.length,mergedCount:merges.length,totalCount:baseItems.length+items.length-merges.length,merges,items};
 // Keep the acquisition ledger byte-for-byte separate from derived records. Its
 // original count/timestamps continue to drive rollback and source-drop guards.
 assert(items.length===msil.warningCount,'Integrated MSIL count mismatch');
 return {...maritime,integration};
}
