import crypto from 'node:crypto';
import {auditMsil} from './msil-audit.mjs';
import {buildReviewView} from './msil-review-view.mjs';
import {verifyTextDuplicate} from './msil-relations.mjs';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
export function publicSupplement({collection,existingItems,reviewed}){
 const audit=auditMsil(collection.pages);if(audit.batchError||!audit.staged?.items.length)throw Error('MSIL audit failed');
 const duplicates=[];
 for(const item of audit.staged.items){
  const old=existingItems.find(x=>x.sourceCountry==='JP'&&x.id==='NAVAREA XI '+item.warningNumber);
  if(!old)continue;const proof=verifyTextDuplicate(item,old);
  if(proof.status==='verified-same-warning-text')duplicates.push({...proof,msilTextSHA256:sha(item.text),existingTextSHA256:sha(old.text)});
 }
 const review={...reviewed,duplicates};
 const view=buildReviewView({audit,review,existingItems,receipts:collection.acquisition.receipts});
 // Explicit supplement contract, distinct from the offline model and timed maritime dataset.
 // Offline stageOnly/publishable guards remain unchanged; no time or cancellation is inferred.
 return{schemaVersion:1,kind:'msil-trial-supplement',activity:'unknown',cancellation:'unknown',
  attribution:view.attribution,constraintsUrl:view.constraintsUrl,warningCount:view.warningCount,
  receivedFeatures:view.receivedFeatures,acceptedFeatures:view.acceptedFeatures,topicCount:view.topicCount,
  verifiedTextMatches:view.verifiedTextMatches,acquisition:collection.acquisition,limitations:view.limitations,
  quarantine:view.quarantine,items:view.items};
}
