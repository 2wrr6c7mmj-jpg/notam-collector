// LOCAL REVIEW ONLY. Do not pass this model to compile.mjs or the production time filters.
import crypto from 'node:crypto';
import {verifyTextDuplicate,reviewActivity} from './msil-relations.mjs';
import {geometryShapes,MSIL_ATTRIBUTION,MSIL_CONSTRAINTS} from './msil-stage.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m);};
export function buildReviewView({audit,review,existingItems,receipts}){
 assert(audit?.stageOnly===true&&audit.publishable===false&&audit.staged?.items?.length>0&&!audit.batchError,'Audited local data required');
 assert(review?.stageOnly===true&&review.publishable===false,'Saved review evidence required');
 assert(Array.isArray(receipts)&&receipts.length>0&&receipts.every(r=>[1,2,3].includes(r.layer)&&Number.isFinite(Date.parse(r.startedAt))),'Acquisition receipt times required');
 const originals=new Map(existingItems.map(i=>[i.id,i])),duplicates=new Map(review.duplicates.map(d=>[d.msilIdentity,d]));
 const topics=new Map([...review.classifications,...review.additionalClassifications].map(c=>[c.identity,c]));
 const ids=new Set();
 const items=audit.staged.items.map(item=>{
  assert(typeof item.identity==='string'&&!ids.has(item.identity),'Duplicate review identity');ids.add(item.identity);
  assert(hash(JSON.stringify(item.text))===item.bodyHash,'Staged text integrity differs');
  const derived=item.geometries.flatMap(geometryShapes);assert(JSON.stringify(derived)===JSON.stringify(item.shapes),'Staged geometry shape integrity differs');
  const topicEvidence=topics.get(item.identity),freshTopic=reviewActivity(item);
  const topicVerified=!!topicEvidence&&topicEvidence.textSHA256===hash(item.text)&&freshTopic.status==='verified-activity-topic'&&topicEvidence.status===freshTopic.status&&JSON.stringify(topicEvidence.subtypes)===JSON.stringify(freshTopic.subtypes);
  let match=null;const proof=duplicates.get(item.identity);
  if(proof){
   const old=originals.get(proof.existingId);assert(old,'Saved counterpart missing');
   const fresh=verifyTextDuplicate(item,old);
   const evidenceMatches=proof.msilTextSHA256===hash(item.text)&&proof.existingTextSHA256===hash(old.text)&&proof.msilCanonicalBodySHA256===fresh.msilCanonicalBodySHA256&&proof.existingCanonicalBodySHA256===fresh.existingCanonicalBodySHA256;
   match={status:evidenceMatches&&fresh.status==='verified-same-warning-text'?'verified-same-warning-text':'review-required',evidenceHashesMatch:evidenceMatches,
    msilTextSHA256:hash(item.text),existingTextSHA256:hash(old.text),canonicalBodySHA256:evidenceMatches?fresh.msilCanonicalBodySHA256:null,
    existing:{id:old.id,text:old.text,sourceUrl:old.sourceUrl,sourceCountry:old.sourceCountry,shapes:structuredClone(old.shapes)},preserveBothGeometries:true,merged:false};
  }
  return {identity:item.identity,name:item.name,text:item.text,sourceLinks:[...item.sourceLinks],issuerCountry:'JP',geographicRegion:null,
   temporal:{activity:'unknown',cancellation:'unknown',publicationInstant:null,periods:null,label:'活動期間・取消状態は未確認',publicationRaw:item.issuedRaw,periodRaw:[...item.evidence.period.raw],cancellationRaw:item.evidence.cancellationEvidence.map(e=>e.raw)},
   topic:{verified:topicVerified,scope:'topic-only',subtypes:topicVerified?[...freshTopic.subtypes]:[],activeAtTime:null},
   geometries:structuredClone(item.geometries),shapes:structuredClone(item.shapes),featureCount:item.featureCount,sourceLayers:[...item.sourceLayers],match};
 });
 assert(items.reduce((n,i)=>n+i.featureCount,0)===audit.acceptedFeatureCount,'Accepted feature accounting differs');
 const times=receipts.map(r=>r.startedAt).sort();
 return{schemaVersion:1,localReviewOnly:true,publishable:false,defaultMode:'all',attribution:MSIL_ATTRIBUTION,constraintsUrl:MSIL_CONSTRAINTS,
  receivedFeatures:audit.sourceFeatureCount,acceptedFeatures:audit.acceptedFeatureCount,warningCount:items.length,topicCount:items.filter(i=>i.topic.verified).length,
  verifiedTextMatches:items.filter(i=>i.match?.status==='verified-same-warning-text').length,
  acquisition:{firstRequestAt:times[0],lastRequestAt:times.at(-1),receiptTimes:structuredClone(receipts),consistentSnapshot:false},
  limitations:['活動期間・取消状態は未確認。現在有効・無効のどちらにも割り当てません。','複数ページは異なる時刻の取得です。同時点の整合性・警報全体の網羅性は未確認です。','発行者JPは地理範囲が日本であることを意味しません。','話題分類は本文の内容を示し、現在活動中であることを示しません。'],
  quarantine:audit.rejected.map(r=>({name:r.name,layer:r.layer,reason:r.reason,mapIncluded:false})),items};
}
export function selectReviewItems(view,{mode='all',query='',topic='all'}={}){
 assert(['all','review'].includes(mode),'Unknown activity cannot be filtered as active or inactive');
 assert(['all','verified-topic'].includes(topic),'Unsupported topic filter');
 const q=String(query).toLocaleLowerCase();return view.items.filter(i=>(topic==='all'||i.topic.verified)&&(!q||[i.identity,i.name,i.text].some(s=>s.toLocaleLowerCase().includes(q))));
}
