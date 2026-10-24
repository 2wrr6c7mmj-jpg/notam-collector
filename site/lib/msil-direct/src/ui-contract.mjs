// Browser-safe candidate guard. Current UI integration must call this before
// accepting either evidence variant; a failed guard retains its last good view.
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw Error('MSIL UI evidence unavailable');};
const period=p=>Number.isFinite(p?.start)&&Number.isFinite(p?.end)&&p.end>p.start;
const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function inspectMsilUiView(value,now=Date.now()) {
  if(value?.schemaVersion!==1||!Array.isArray(value.items)||!value.items.length||value.items.length>10000||value.count!==value.items.length||!Array.isArray(value.originalHashes)||value.originalHashes.length!==value.items.length)fail();
  const sourceAt=Date.parse(value.sourceCompletedAt);if(!Number.isFinite(sourceAt)||sourceAt>now)fail();
  const direct=value.kind==='msil-ui-direct-projection';
  if(!direct&&value.kind!=='msil-ui-projection')fail();
  const evidence=direct?value.directEvidence:value.publicEvidence;
  if(!evidence||evidence.sourceCompletedAt!==value.sourceCompletedAt||(direct?value.publicEvidence:value.directEvidence))fail();
  const checkedAt=direct?evidence.readAt:evidence.verifiedAt;
  if(!Number.isFinite(checkedAt)||checkedAt<sourceAt||checkedAt>now)fail();
  const expected=direct?evidence.projectionSha256:evidence.sha256;
  if(!hash(expected)||!hash(value.snapshotSha256))fail();
  if(direct){if(evidence.origin!=='https://api.msil.go.jp'||evidence.transport!=='official-public-trial-v2'||evidence.transportComplete!==true||evidence.consistentSnapshot!==false||evidence.fullWarningCoverage!==false)fail();}
  else if(evidence.origin!=='https://notam-watch.pages.dev'||evidence.snapshotSha256!==value.snapshotSha256)fail();
  if(value.acquisition?.transportComplete!==true||value.acquisition.consistentSnapshot!==false||value.acquisition.fullWarningCoverage!==false||value.acquisition.completedAt!==value.sourceCompletedAt||!['ok','error'].includes(value.refreshState))fail();
  if(typeof value.attribution!=='string'||!safeLink(value.constraintsUrl))fail();
  const ids=new Set(),originals=new Map(value.originalHashes.map(h=>[h.identity,h.textSha256]));
  if(originals.size!==value.items.length||[...originals.values()].some(h=>!hash(h)))fail();
  for(const item of value.items){
    if(typeof item.msilIdentity!=='string'||ids.has(item.msilIdentity)||item.id!==item.msilIdentity||!originals.has(item.msilIdentity)||typeof item.text!=='string'||item.text.length>200000||item.dataset!=='maritime'||item.sourceCountry!=='JP'||!Array.isArray(item.originals)||item.originals.length!==1||item.originals[0].text!==item.text)fail();ids.add(item.msilIdentity);
    if(await digest(new TextEncoder().encode(item.text))!==originals.get(item.msilIdentity))fail();
    if(!safeLink(item.sourceUrl)||!Array.isArray(item.sourceLinks)||!item.sourceLinks.length||item.sourceLinks.some(x=>!safeLink(x))||!Array.isArray(item.originals[0].sourceLinks)||item.originals[0].sourceLinks.some(x=>!safeLink(x)))fail();
    if(!Array.isArray(item.shapes)||item.shapes.some(s=>!['point','line','polygon','circle'].includes(s.kind)||!Array.isArray(s.points)||!s.points.length||s.points.some(p=>!Array.isArray(p)||p.length!==2||!Number.isFinite(p[0])||Math.abs(p[0])>90||!Number.isFinite(p[1])||Math.abs(p[1])>180)||(s.kind==='circle'&&(!Number.isFinite(s.radius)||s.radius<=0))||(s.sourceIndex!==undefined&&s.sourceIndex!==0)))fail();
    const schedule=item.staticSchedule;
    if(!Array.isArray(schedule?.periods)||!schedule.periods.every(period)||(schedule.validityPeriods!==undefined&&(!Array.isArray(schedule.validityPeriods)||!schedule.validityPeriods.every(period)))||(schedule.openEndedPeriods!==undefined&&(!Array.isArray(schedule.openEndedPeriods)||!schedule.openEndedPeriods.every(p=>Number.isFinite(p?.start)&&p.end===null))))fail();
    if(item.issued!==null&&!Number.isFinite(item.issued)||typeof item.cancelled!=='boolean'||!Array.isArray(item.warnings)||!item.warnings.every(x=>typeof x==='string')||!item.detail||typeof item.detail.label!=='string'||!Array.isArray(item.detail.details)||!item.detail.details.every(x=>typeof x==='string'))fail();
  }
  // Integrity check of the exact projection, excluding transport-level metadata.
  const projection=Object.fromEntries(Object.entries(value).filter(([key])=>!['directEvidence','publicEvidence','sourceStale','sourceRefreshState'].includes(key)));
  const bytes=new TextEncoder().encode(JSON.stringify(projection));if(bytes.length>6*1024*1024)fail();
  const actual=await digest(bytes);if(actual!==expected)fail();
  return {kind:direct?'direct':'pages',checkedAt,sourceCompletedAt:value.sourceCompletedAt,
    stale:now-sourceAt>8*3600000||value.sourceStale===true||value.sourceRefreshState==='error'||value.refreshState==='error'};
}
