// No duplicate date/geometry parsing: these are pinned copies of Pages functions.
import reviewed from '../vendor/reviewed-evidence.mjs';
import {publicSupplement} from '../vendor/notam-update-bridge/public-supplement.mjs';
import {validateMsilSupplement} from '../vendor/notam-static-trial/src/msil-contract.mjs';
import {integrateMsil} from '../vendor/notam-update-bridge/integrate-msil.mjs';
import {createMsilPublicArtifact} from '../vendor/notam-update-bridge/public-projection.mjs';
import crypto from 'node:crypto';

export const RAW_MAX_BYTES = 768 * 1024;
export function validateSavedSource(source) {
  validateMsilSupplement(source);
  if (!source?.items?.length || !source.acquisition?.completedAt || new TextEncoder().encode(JSON.stringify(source)).length > RAW_MAX_BYTES) throw Error('MSIL saved source unavailable');
  // The common audit can retain a standard warning with no extracted links.
  // Such a source cannot satisfy the UI provenance contract, so never replace
  // the last usable source with a record the browser must reject.
  if (source.items.some(item=>!item.sourceLinks.length||item.sourceLinks.some(link=>{
    try { const url=new URL(link); return url.protocol!=='https:'||Boolean(url.username||url.password); }
    catch { return true; }
  }))) throw Error('MSIL source links unavailable');
  return source;
}
export function normalizeCollection(collection, previous) {
  const source = {...publicSupplement({collection, existingItems:[], reviewed}), refreshState:'ok',
    refreshMessage:'試用APIから取得した保存原文です。全警報の網羅性は未確認です。'};
  validateSavedSource(source);
  if (previous?.items?.length && source.items.length < previous.items.length * .5) throw Error('MSIL count drop requires review');
  return source;
}
export function projectSavedSource(source, now = Date.now()) {
  validateSavedSource(source);
  const buildAt = source.acquisition.completedAt;
  if (!Number.isFinite(now) || Date.parse(buildAt) > now) throw Error('MSIL source time invalid');
  const snapshot = {schemaVersion:1, buildAt, msil:source, maritime:integrateMsil({items:[]}, source)};
  const artifact = createMsilPublicArtifact(new TextEncoder().encode(JSON.stringify(snapshot)));
  if (!artifact) throw Error('MSIL projection unavailable');
  // A direct acquisition is not a Pages release. Consumers need this explicit
  // evidence variant rather than a fabricated publicEvidence verification.
  const projection={...artifact.projection, kind:'msil-ui-direct-projection'};
  const projectionSha256=crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  return {...projection, directEvidence:{
    origin:'https://api.msil.go.jp', transport:'official-public-trial-v2',
    projectionSha256, sourceCompletedAt:buildAt,
    readAt:now, transportComplete:true, consistentSnapshot:false, fullWarningCoverage:false}};
}
