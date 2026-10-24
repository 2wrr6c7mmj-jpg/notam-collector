import {validateTaiwanEvidence,completeTaiwanEvidence,validTaiwanInterpretation} from '../nav-tw-contract.mjs';
// Projection only. The existing immutable PDF-evidence path is unchanged.
export const TAIWAN_SOURCE_MAX_AGE=8*3600000;
export function projectTaiwanSourceStatus(n,{now=Date.now()}={}){
 const raw=n.taiwan;if(n.sourceCountry!=='TW'||raw===undefined)return n;
 const e=validateTaiwanEvidence(raw),complete=completeTaiwanEvidence(e,n.sourceUrl,now,TAIWAN_SOURCE_MAX_AGE)&&validTaiwanInterpretation(n);
 if(complete&&!n.cancelled&&!n.lifecycleUncertain&&!e?.supersededBy)return n;
 const reason=e?.supersededBy?'更新後の公告があるため旧区域を表示していません。':'本文・全添付の現在の照合証跡が未完了または8時間を超えています。';
 const status={cancelled:!!n.cancelled,periods:[],requiresReview:true,completeness:'unknown',label:'添付原文の再確認待ち',details:[reason]};
 return {...n,shapes:[],validityPeriods:[],start:null,end:null,timeUncertain:true,reviewNeeded:true,sourceStale:!complete,staticSchedule:status,detail:status,warnings:[...new Set([...(n.warnings||[]),reason])]};
}
