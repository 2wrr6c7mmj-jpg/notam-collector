// Shared runtime contract for producer materialization, public projection and UI.
// No network, source documents or reviewed-text cache is imported here.
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const string=(v,max=8192)=>typeof v==='string'&&v.length<=max;
const https=v=>{if(!string(v))return false;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const optional=(v,check)=>v===undefined||check(v);
const date=v=>object(v)&&['day','instant'].includes(v.precision)&&string(v.value,64)&&string(v.evidence)&&(
 v.precision==='day'?/^\d{4}-\d{2}-\d{2}$/.test(v.value)&&Number.isFinite(Date.parse(v.value))&&new Date(Date.parse(v.value)).toISOString().slice(0,10)===v.value:
 /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.value)&&Number.isFinite(Date.parse(v.value)));
export function validateTaiwanEvidence(value){
 try{
  if(!object(value)||value.version!==2||!['MND','MOA','FA','MOTC'].includes(value.publisher)||!['primary','supplement'].includes(value.role)||typeof value.bodyComplete!=='boolean'||typeof value.semanticComplete!=='boolean')return null;
  if(!optional(value.publication,date)||!optional(value.issue,date)||!Array.isArray(value.documents)||value.documents.length>128||!Array.isArray(value.attachments)||value.attachments.length>64||!Array.isArray(value.unresolved)||value.unresolved.some(x=>!string(x)))return null;
  if(value.documents.some(d=>!object(d)||!https(d.url)||!optional(d.requestedUrl,https)||!Number.isSafeInteger(d.fetchedAt)||d.fetchedAt<0||d.fetchedAt>8640000000000000||!Number.isInteger(d.status)||d.status<100||d.status>599||!Number.isSafeInteger(d.bytes)||d.bytes<0||!string(d.sha256,64)||!/^[a-f0-9]{64}$/.test(d.sha256)||!string(d.mediaType,256)||!['complete','unsupported','unread'].includes(d.extraction)||!optional(d.reason,string)||!optional(d.etag,string)||!optional(d.lastModified,string)))return null;
  if(value.attachments.some(a=>!object(a)||!https(a.url)||!['pending','complete','unsupported','error'].includes(a.state)||!optional(a.reason,string))||new Set(value.attachments.map(a=>a.url)).size!==value.attachments.length)return null;
  if(!object(value.rights)||!['metadata-open','unverified'].includes(value.rights.status)||!https(value.rights.url)||!string(value.rights.detail))return null;
  if(!optional(value.issueReference,string)||!optional(value.supersededBy,https)||!optional(value.amendment,a=>object(a)&&a.kind==='supersedes'&&string(a.targetReference)&&string(a.evidence)))return null;
  return value;
 }catch{return null;}
}
export function completeTaiwanEvidence(value,sourceUrl,now=Date.now(),maxAge=8*3600000){
 const e=validateTaiwanEvidence(value);if(!e||e.semanticComplete!==true||e.bodyComplete!==true||!e.attachments.length)return false;
 const urls=new Set(e.documents.map(d=>d.requestedUrl||d.url));
 return urls.has(sourceUrl)&&e.documents.length>=e.attachments.length+1&&e.attachments.every(a=>a.state==='complete'&&urls.has(a.url))&&e.documents.every(d=>d.extraction==='complete'&&d.status>=200&&d.status<300&&d.bytes>0&&d.fetchedAt<=now&&now-d.fetchedAt<=maxAge);
}
// Coordinate/period validity is independent of complete semantics and freshness.
export function validTaiwanPeriods(n){
 try{
  if(!object(n)||!Array.isArray(n.validityPeriods)||n.validityPeriods.length>4096||n.validityPeriods.some(p=>!object(p)||!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.end<=p.start||Math.abs(p.start)>8640000000000000||Math.abs(p.end)>8640000000000000))return false;
  return n.validityPeriods.length>0?n.start===Math.min(...n.validityPeriods.map(p=>p.start))&&n.end===Math.max(...n.validityPeriods.map(p=>p.end)):n.start===null&&n.end===null;
 }catch{return false;}
}
export function validTaiwanShape(shape){
 try{
  if(!object(shape)||Object.keys(shape).some(k=>!['kind','points','provenance','sourceReference','inferredClose','partialBoundary','approx'].includes(k))||['inferredClose','partialBoundary','approx'].some(k=>shape[k]!==undefined&&typeof shape[k]!=='boolean')||shape.provenance!==undefined&&shape.provenance!=='text'||!['point','line','polygon'].includes(shape.kind)||shape.holes?.length||!Array.isArray(shape.points)||shape.points.length<1||shape.points.length>256||shape.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180))return false;
  if(shape.kind==='point')return shape.points.length===1;
  if(shape.kind==='line')return shape.points.length>=2&&shape.points.every((p,i)=>i===0||JSON.stringify(p)!==JSON.stringify(shape.points[i-1])&&Math.abs(p[1]-shape.points[i-1][1])<=180);
  const points=[...shape.points];if(JSON.stringify(points[0])===JSON.stringify(points.at(-1)))points.pop();
  if(points.length<3||new Set(points.map(p=>JSON.stringify(p))).size!==points.length)return false;
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0);if(!Number.isFinite(area)||Math.abs(area)<1e-10)return false;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){if(j===i+1||i===0&&j===points.length-1)continue;const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return false;}
  return true;
 }catch{return false;}
}
export function validTaiwanInterpretation(n){
 try{
  if(!validTaiwanPeriods(n)||!Array.isArray(n.shapes)||!n.shapes.length||n.shapes.length>64||!n.shapes.every(s=>s.kind==='polygon'&&validTaiwanShape(s)))return false;
  return n.timeUncertain===false&&n.validityPeriods.length>0||n.timeUncertain===true&&n.validityPeriods.length===0;
 }catch{return false;}
}
