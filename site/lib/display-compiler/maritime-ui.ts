import {projectTaiwanSourceStatus} from './taiwan-source-status.mjs';
import {withMsilPublication} from './msil-publication.mjs';
import type {Notice} from './notam';
import {TAIWAN_PDF_MAX_AGE} from './taiwan-pdf-runtime.mjs';
import {MSIL_PUBLIC_MAX_AGE} from './msil-public';
export type PublicMsilView={items:Notice[];sourceCompletedAt:string;refreshState:string;refreshMessage?:string;attribution:string;constraintsUrl:string;kind?:'msil-ui-projection'|'msil-ui-direct-projection';sourceStale?:boolean;sourceRefreshState?:string;publicEvidence?:{sha256:string;snapshotSha256:string;verifiedAt:number;sourceCompletedAt:string};directEvidence?:{origin:string;projectionSha256:string;readAt:number;sourceCompletedAt:string}};
/** Projection only: returned rows never go back to nav_sources or collector responses. */
export function composeMaritimeUi(items:Notice[],msil:PublicMsilView|null,now:number):Notice[]{
 const current=items.map(n=>projectTaiwanSourceStatus(n,{now}) as Notice).map(n=>{
  const packet=n.taiwanPdf;if(n.sourceCountry!=='TW'||packet?.status!=='ok')return n;
  const other=(packet as typeof packet&{otherDocuments?:{checkedAt:number}[]}).otherDocuments;
  if(!Array.isArray(packet.documents)||other!==undefined&&!Array.isArray(other))return {...n,shapes:[],sourceStale:true};
  const times=[packet.checkedAt,packet.articleCheckedAt,...packet.documents.map(d=>d?.checkedAt),...(other||[]).map(d=>d?.checkedAt)];
  if(times.every(t=>Number.isFinite(t)&&t>0&&t<=now&&now-t<=TAIWAN_PDF_MAX_AGE))return n;
  return {...n,shapes:[],sourceStale:true,warnings:[...n.warnings,'台湾添付の照合から8時間を超えたため、更新まで地図の区域を表示していません。']};
 });
 if(!msil)return current;
 const age=now-Date.parse(msil.sourceCompletedAt),fresh=Number.isFinite(age)&&age>=0&&age<=MSIL_PUBLIC_MAX_AGE&&msil.sourceStale!==true&&msil.sourceRefreshState!=='error'&&msil.refreshState!=='error';
 const projected=msil.items.map(withMsilPublication).map(n=>fresh?n:{...n,shapes:[],sourceStale:true,detail:{...n.detail,label:'海しる保存分・要更新',details:['取得時刻または更新状態を確認できないため、地図の区域を表示していません。確認済みの日程と原文は保持しています。',...(n.detail?.details||[])],requiresReview:n.detail?.requiresReview},warnings:[...n.warnings,'海しるの取得時刻・更新状態の確認が必要です。']});
 return [...current.filter(n=>n.msilIdentity||!(n.sourceCountry==='JP'&&/^NAVAREA XI\s+\d{2,4}-\d+$/i.test(n.id))),...projected];
}

export const msilViewCheckedAt=(msil:PublicMsilView)=>msil.directEvidence?.readAt??msil.publicEvidence?.verifiedAt??0;
