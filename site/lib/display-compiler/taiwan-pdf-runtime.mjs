import {extractTaiwanPdfEvidence,rocDate,coordinate} from './taiwan-pdf-evidence.mjs';
export const TAIWAN_PDF_MAX_AGE=8*3600000;
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),x=>x.toString(16).padStart(2,'0')).join('');
export function officialUrl(value,kind){try{const u=new URL(value);return u.origin==='https://www.fa.gov.tw'&&!u.username&&!u.password&&!u.hash&&(kind==='article'?u.pathname==='/view.php':u.pathname==='/redirect_file.php')&&u.searchParams.get('theme')==='Shooting_bulletin'&&/^\d+$/.test(u.searchParams.get('id')||'');}catch{return false;}}
export const noticeFingerprint=n=>JSON.stringify([n.id,n.sourceUrl,n.location,n.text,n.cancelled||false]);
// Evidence of attachment membership, not a signature or proof of authenticity.
// Only the official page's download-list is supported; navigation/comment links are excluded.
export function pdfLinks(html,articleUrl){
 const clean=html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const lists=[...clean.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi)].filter(m=>/\bclass\s*=\s*(["'])[^"']*\bdownload-list\b[^"']*\1/i.test(m[1]));
 if(lists.length!==1)throw Error('Official attachment list not identified');
 const links=[];
 for(const a of lists[0][2].matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/a>/gi)){
  if(!/\bPDF\b/i.test(a[0]))continue;
  try{const url=new URL(a[2].replace(/&amp;/g,'&'),articleUrl).href;if(officialUrl(url,'pdf')&&!links.includes(url))links.push(url);}catch{}
 }
 return links;
}
const normalized=s=>s.normalize('NFKC').replace(/(?<=\d)[ \t]+(?=\d)/g,'').replace(/月[ \t]*份/g,'月份').replace(/時[ \t]*段[ \t]*申[ \t]*請[ \t]*表/g,'時段申請表');
function declarationWindows(page){
 // Only this family's two dated clauses; remove known adjacent table-column labels.
 const s=page.replace(/\s/g,''),m=s.match(/民國(\d{3})年([\s\S]*?)標準時間/);
 if(!m)return null;
 const body=m[2].replace(/交通部航港局(?:北部|中部|南部)航務中心|交通部航港局|交通部航政司|射擊日期/g,'');
 const p=body.match(/^(\d{1,2})月(\d{1,2})日至(\d{1,2})月(\d{1,2})日,(\d{4})-(\d{4})時及(\d{1,2})月(\d{1,2})日(\d{4})-(\d{4})時,共計(\d+)日。\($/);
 if(!p)return null;
 const first=rocDate(+m[1],+p[1],+p[2]),last=rocDate(+m[1],+p[3],+p[4]),extra=rocDate(+m[1],+p[7],+p[8]);
 if(!first||!last||!extra||last<first||extra<=last)return null;
 const days=(Date.parse(last)-Date.parse(first))/86400000+1;if(days>31||days+1!==+p[11])return null;
 return [...Array.from({length:days},(_,i)=>({date:new Date(Date.parse(first)+i*86400000).toISOString().slice(0,10),startClock:p[5],endClock:p[6]})),{date:extra,startClock:p[9],endClock:p[10]}];
}
function chineseBoundary(page){
 const text=page.split('NOTICE TO MARINERS')[0].replace(/\s/g,'');
 if(!/位置:/.test(text)||!text.includes('WGS84'))return null;
 const rows=[...text.matchAll(/([A-Z]):(北緯|南緯)([^,]+),(東經|西經)([^。]+)。/g)];
 if(rows.length!==4||rows.map(r=>r[1]).join('')!=='ABCD')return null;
 const points=rows.map(r=>[coordinate(r[3]+(r[2]==='北緯'?'N':'S')),coordinate(r[5]+(r[4]==='東經'?'E':'W'))]);
 if(points.some(p=>p.some(x=>!x)))return null;
 return points.map(p=>p.map(x=>x.value));
}
/** Supported family: one 3-page Zhongfu declaration + firing/GMT table + bilingual boundary.
 * Dates and coordinates come from content, not attachment IDs or historical hashes.
 * A minimum-radius cell never becomes a circle or proof of complete coverage.
 */
export function parseTaiwanPdfDocument(document){
 const no=reason=>({status:'review-needed',reason,periods:[],shapes:[]});
 if(document.pages?.length!==3)return no('unsupported-page-family');
 const pages=document.pages.map(normalized),[a,b,c]=pages;
 if(!/射擊地點\s*中福海灘/.test(a)||!/格林威治標準時間/.test(b)||!/NOTICE TO MARINERS/.test(c)||!/下列位址連線範圍內/.test(c))return no('area-table-family-unverified');
 if(/備用|備射|協調時間|取消|暫停|除外|每日|翌|次日|次月/.test(pages.join('\n')))return no('reserve-coordination-or-calendar-qualifier');
 const evidence=extractTaiwanPdfEvidence({...document,pages});
 const p1=evidence.pages[0].polygonEvidence,p3=evidence.pages[2].polygonEvidence;
 const points=p=>p?.points.map(p=>[p.lat,p.lon]);
 if(p1?.points.length!==4||JSON.stringify(points(p1))!==JSON.stringify(points(p3)))return no('cross-page-boundary-mismatch');
 if(JSON.stringify(chineseBoundary(c))!==JSON.stringify(points(p3)))return no('bilingual-boundary-mismatch');
 const windows=evidence.pages[1].sourceWindows;
 const gmt=windows.filter(w=>w.zone==='GMT'&&w.role==='standard-time'),local=windows.filter(w=>w.role==='firing');
 if(!gmt.length||gmt.length>31||gmt.length!==local.length||windows.length!==gmt.length*2)return no('table-columns-unresolved');
 // Check the activity sentence, never the publication heading, against every table date.
 const period=c.match(/說\s*明\s*[:：]\s*(\d{3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*至\s*(\d{1,2})\s*日/);
 if(!period)return no('activity-date-span-unverified');
 const first=rocDate(+period[1],+period[2],+period[3]),last=rocDate(+period[1],+period[2],+period[4]);
 if(!first||!last||first>last||!a.includes(period[1]+' 年')&&!a.includes(period[1]+'年'))return no('calendar-mismatch');
 const english=c.match(/Details\s*:\s*Military exercise will be undertaken on\s+(\w+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})/);
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 if(!english||months.indexOf(english[1])+1!==+period[2]||+english[2]!==+period[3]||+english[3]!==+period[4]||+english[4]!==+period[1]+1911)return no('bilingual-activity-date-conflict');
 if(gmt.some((w,i)=>!w.utcEvidence||w.reserve||local[i].reserve||w.date!==local[i].date||w.date<first||w.date>last))return no('area-time-correspondence-unresolved');
 const declared=declarationWindows(a),table=local.map(({date,startClock,endClock})=>({date,startClock,endClock}));
 if(!declared||declared[0].date!==first||declared.at(-1).date!==last||JSON.stringify(declared)!==JSON.stringify(table))return no('declaration-table-date-time-conflict');
 // GMT is explicit; the independent firing column must describe the same durations.
 const mins=s=>+s.slice(0,2)*60 + +s.slice(2);
 if(gmt.some((w,i)=>mins(local[i].startClock)-mins(w.startClock)!==480||mins(local[i].endClock)-mins(w.endClock)!==480))return no('firing-gmt-columns-conflict');
 const polygon=points(p1);
 const crosses=polygon.map((a,i)=>{const b=polygon[(i+1)%4],c=polygon[(i+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);});
 if(crosses.some(x=>!Number.isFinite(x)||Math.abs(x)<1e-10)||!crosses.every(x=>Math.sign(x)===Math.sign(crosses[0])))return no('polygon-needs-review');
 const periods=gmt.map(w=>({start:Date.parse(w.utcEvidence.start),end:Date.parse(w.utcEvidence.end),scopeLabel:'判読した部分図形のみ',raw:w.raw}));
 return {status:'partial',periods,shapes:[{kind:'polygon',points:points(p1),partialBoundary:true,approx:false,provenance:'text',sourceReference:document.sourceUrl,validityPeriods:periods}],yearBasis:'民国'+period[1]+'年 = '+(+period[1]+1911)+'年',zone:'GMT/UTC explicit',unresolved:['minimum-radius-and-total-extent','unannounced-changes']};
}
/** Called by normal compilation; never performs network requests. */
export function restoreTaiwanPdf(n){
 if(!n.taiwanPdfOriginal)return n;
 const {taiwanPdfOriginal:original,taiwanPdfResult:result,...rest}=n;
 return {...rest,...original,...(n.cancelled?{cancelled:true}:{})};
}
// Invalid current v2 evidence cannot leave stale upstream ODT geometry actionable.
export function invalidateTaiwanGeometry(n){
 const status={cancelled:!!n.cancelled,periods:[],requiresReview:true,completeness:'unknown',label:'添付原文の確認が必要',details:['添付資料の区域・日時は未確定です。原文を確認してください。']};
 return {...n,shapes:[],validityPeriods:[],start:null,end:null,timeUncertain:true,reviewNeeded:true,coverage:{geometry:'unknown',time:'unknown',negativeSpatialConclusionAllowed:false,negativeTemporalConclusionAllowed:false},staticSchedule:status,detail:status,originals:(n.originals||[]).map(o=>({...o,shapes:[]}))};
}
function verifiedSourceSummary(n,summary){
 const fields=['shapes','validityPeriods','start','end','timeUncertain'];
 if(!summary||JSON.stringify(fields.map(k=>summary[k]??null))!==JSON.stringify(fields.map(k=>n[k]??null)))return false;
 const periods=n.validityPeriods||[];
 if(!Array.isArray(periods)||periods.some(p=>!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.end<=p.start))return false;
 if(n.start!==null&&(!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.end<=n.start))return false;
 return Array.isArray(n.shapes)&&n.shapes.every(shape=>{
  if(!shape||shape.holes?.length||!Array.isArray(shape.points)||shape.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180))return false;
  if(shape.kind==='circle')return shape.points.length===1&&Number.isFinite(shape.radius)&&shape.radius>0&&shape.radius<20040000;
  if(shape.kind!=='polygon')return false;
  const points=[...shape.points];if(JSON.stringify(points[0])===JSON.stringify(points.at(-1)))points.pop();
  if(points.length<3||points.length>1000||new Set(points.map(p=>JSON.stringify(p))).size!==points.length)return false;
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0);
  if(!Number.isFinite(area)||Math.abs(area)<1e-10)return false;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
   if(j===i+1||i===0&&j===points.length-1)continue;
   const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
   if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return false;
  }
  return true;
 });
}
export async function applyTaiwanPdf(n,{now=Date.now()}={}){
 n=restoreTaiwanPdf(n);
 const packet=n.taiwanPdf;if(n.sourceCountry!=='TW'||!packet)return n;
 let base=n;
 const no=(reason,{retain=false}={})=>{
  const safe=packet.evidenceSchemaVersion===2&&!retain?invalidateTaiwanGeometry(base):base;
  return {...safe,reviewNeeded:true,taiwanPdfResult:{status:'review-needed',reason},detail:{...safe.detail,requiresReview:true,label:packet.evidenceSchemaVersion===2?'添付原文の確認が必要':'PDFの確認が必要',details:[...(safe.detail?.details||[]),packet.evidenceSchemaVersion===2?'添付資料の区域・日時は原文と照合してください。':'PDFの区域・日時は未確定です。原文を確認してください。']}};
 };
 if(n.cancelled||n.lifecycleUncertain||n.overview?.deletedPublication||/取消|撤銷|暫停|刪除/.test(n.location||''))return no('cancelled-or-revised');
 if(packet.schemaVersion!==1||packet.status!=='ok'||!officialUrl(n.sourceUrl,'article')||packet.articleUrl!==n.sourceUrl||packet.noticeSha256!==await digest(noticeFingerprint(n)))return no('source-binding-unverified');
 const fresh=t=>Number.isSafeInteger(t)&&t<=now&&now-t<=TAIWAN_PDF_MAX_AGE;
 if(!fresh(packet.checkedAt)||!fresh(packet.articleCheckedAt)||!Array.isArray(packet.documents)||(packet.evidenceSchemaVersion!==2&&packet.documents.length>3)||new TextEncoder().encode(JSON.stringify(packet)).byteLength>8*1024*1024)return no('stale-or-incomplete');
 const article=packet.articleEvidence;
 if(!article||article.url!==n.sourceUrl||article.checkedAt!==packet.articleCheckedAt||typeof article.html!=='string'||new TextEncoder().encode(article.html).length>512*1024||article.htmlSha256!==await digest(article.html))return no('article-attachment-evidence-unverified');
 let links;try{links=pdfLinks(article.html,article.url);}catch{return no('article-attachment-list-unverified');}
 if(links.length!==packet.documents.length||packet.documents.some((d,i)=>d.sourceUrl!==links[i]))return no('article-document-membership-mismatch');
 const results=[];
 for(const d of packet.documents){
  if(!officialUrl(d.sourceUrl,'pdf')||!fresh(d.checkedAt)||!Array.isArray(d.pages)||d.pages.length===0||d.pages.length>20||d.pages.some(p=>typeof p!=='string'||p.length>100000)||d.pages.join('').length>250000||!/^[a-f0-9]{64}$/.test(d.pdfSha256)||d.pagesSha256!==await digest(JSON.stringify(d.pages)))return no('document-integrity-unverified');
  try{results.push({document:d,parsed:parseTaiwanPdfDocument(d)});}catch{return no('malformed-evidence');}
 }
 base={...n,originals:[{sourceName:n.sourceName,text:n.text,sourceLinks:[n.sourceUrl],shapes:n.shapes},...packet.documents.map(x=>({sourceName:'台湾漁業署 添付PDF',text:x.pages.join('\n\n'),sourceLinks:[x.sourceUrl],shapes:[]}))]};
 const htmlText=article.html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,raw)=>{const v=raw[0].toLowerCase()==='x'?parseInt(raw.slice(1),16):Number(raw);return v<=0x10ffff?String.fromCodePoint(v):'\ufffd';});
 const other=packet.otherDocuments||[];
 if(!Array.isArray(other)||other.some(d=>typeof d.text!=='string'))return no('malformed-other-evidence');
 base.originals.push(...other.map(d=>({sourceName:'台湾漁業署 添付ODT',text:d.text,sourceLinks:[d.sourceUrl],shapes:[]})));
 const allText=[n.location,n.text,htmlText,...other.map(d=>d.text),...packet.documents.flatMap(d=>d.pages)].join('\n').normalize('NFKC');
 if(/取消|撤銷|撤销|暫停|暂停|停止|中止|作廢|作废|更正|修正|修訂|修订|cancel(?:led|ed|lation)|supersed|revis(?:ed|ion)/i.test(allText.replace(/\s+/g,'')))return no('cancellation-or-revision-evidence');
 for(const d of packet.documents){
  if(d.layout!==undefined&&(!Array.isArray(d.layout)||d.layout.some(p=>!p||!Array.isArray(p.rotatedText)||p.rotatedText.some(t=>typeof t!=='string'||! /^[\s()（）]*$/.test(t)))))return no('substantive-rotated-text-needs-review');
 }
 if(n.shapes.length||n.validityPeriods?.length||n.start!==null||n.end!==null){
  if(packet.evidenceSchemaVersion===2&&!verifiedSourceSummary(n,packet.sourceSummary))return no('existing-parsed-data-unverified');
  return no('existing-parsed-data-retained',{retain:true});
 }
 if(!/中福/.test(n.location||''))return no('article-area-family-unverified');
 const valid=results.filter(r=>r.parsed.status==='partial');
 if(valid.length!==1)return no('no-unique-supported-area-table');
 const {document:d,parsed:p}=valid[0];
 const details=[...p.periods.map(x=>`${new Date(x.start).toISOString().slice(0,16)} ～ ${new Date(x.end).toISOString().slice(0,16)} UTC`),'部分図形のみ。最小半径と全範囲の関係、全海域の実施時間は未確定です。外側・既知時間外も対象外とは判断できません。'];
 const schedule={cancelled:false,periods:p.periods,requiresReview:true,completeness:'partial',label:'PDF：部分区域の日時（UTC）',details};
 const original=Object.fromEntries(['shapes','validityPeriods','start','end','timeUncertain','reviewNeeded','coverage','staticSchedule','detail','warnings','originals','maritimeAttachment'].map(k=>[k,n[k]??null]));
 return {...n,taiwanPdfOriginal:original,shapes:p.shapes,validityPeriods:p.periods,start:null,end:null,timeUncertain:true,reviewNeeded:true,
  coverage:{geometry:'partial',time:'known-component-only',negativeSpatialConclusionAllowed:false,negativeTemporalConclusionAllowed:false},
  staticSchedule:schedule,detail:schedule,taiwanPdfResult:{status:'partial',sourceUrl:d.sourceUrl,pdfSha256:d.pdfSha256,yearBasis:p.yearBasis,zone:p.zone},
  warnings:[...n.warnings,details.at(-1)],
  originals:base.originals,
  maritimeAttachment:{status:'fulltext-retained',format:'pdf',sourceUrl:d.sourceUrl,checkedAt:d.checkedAt,bodyFetchedAt:d.checkedAt,textTruncated:false}};
}
