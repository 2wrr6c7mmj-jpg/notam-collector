// Supported family only: native WGS84 polygon + explicitly UTC+8 scheduled-time ODT tables.
import { unzipSync, Unzip, UnzipInflate, strFromU8 } from 'fflate/browser';
import type { Notice, Point, Shape } from './notam';
import { parseTwTimeWindows } from './nav-tw-time';
export const TW_ODT_MAX_ZIP = 5 * 1024 * 1024;
export const TW_ODT_MAX_XML = 2 * 1024 * 1024;
const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
type X = { name: string; local: string; uri: string; attrs: Record<string,string>; ns: Record<string,string>; children: Array<X|string> };
function bad(message: string): never { throw new Error(`台湾ODT未解析：${message}`); }
function entities(s:string):string {
  if(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(s)) bad('未対応のXML実体参照');
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,n:string)=>{
    if(n[0]!=='#') return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[n] ?? bad('XML実体');
    const cp=n[1].toLowerCase()==='x'?parseInt(n.slice(2),16):+n.slice(1);
    if(cp>0x10ffff||cp<0x20&&!([9,10,13].includes(cp))||cp>=0xd800&&cp<=0xdfff)bad('XML文字参照');
    return String.fromCodePoint(cp);
  });
}
function xmlTree(xml:string):X {
  if(new TextEncoder().encode(xml).length>TW_ODT_MAX_XML||/<!DOCTYPE|<!ENTITY/i.test(xml))bad('XMLサイズまたはDTD/実体宣言');
  const root:X={name:'root',local:'root',uri:'',attrs:{},ns:{},children:[]},stack=[root];let at=0,nodes=0;
  while(at<xml.length){
    if(xml[at]!=='<'){const end=xml.indexOf('<',at),stop=end<0?xml.length:end;stack[stack.length-1].children.push(entities(xml.slice(at,stop)));at=stop;continue;}
    if(xml.startsWith('<!--',at)){const end=xml.indexOf('-->',at+4);if(end<0)bad('コメント未終端');at=end+3;continue;}
    if(xml.startsWith('<?',at)){const end=xml.indexOf('?>',at+2);if(end<0||!/^<\?xml\s/i.test(xml.slice(at,end+2))||stack.length!==1)bad('XML処理命令');at=end+2;continue;}
    if(xml.startsWith('<!',at))bad('未対応XML宣言');
    let end=at+1,quote='';for(;end<xml.length;end++){const c=xml[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end===xml.length)bad('XMLタグ未終端');const tag=xml.slice(at+1,end);at=end+1;
    if(tag[0]==='/'){if(stack.length<2||stack.pop()!.name!==tag.slice(1).trim())bad('XMLタグ不一致');continue;}
    const m=tag.match(/^([\w:.-]+)([\s\S]*?)(\/)?$/);if(!m)bad('XMLタグ不正');
    const attrs:Record<string,string>={},parts=m[2];let pos=0;const ar=/\s+([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/gy;let a:RegExpExecArray|null;
    while((a=ar.exec(parts))){if(a[1] in attrs)bad('重複XML属性');attrs[a[1]]=entities(a[3]);pos=ar.lastIndex;}
    if(parts.slice(pos).trim())bad('XML属性不正');const ns={...stack[stack.length-1].ns};for(const [k,v]of Object.entries(attrs)){if(k==='xmlns')ns['']=v;else if(k.startsWith('xmlns:'))ns[k.slice(6)]=v;}
    const [prefix,local]=m[1].includes(':')?m[1].split(':'):['',m[1]];if(prefix&&!ns[prefix])bad('未定義XML名前空間');
    const node:X={name:m[1],local,uri:ns[prefix]||'',attrs,ns,children:[]};stack[stack.length-1].children.push(node);
    if(++nodes>40000||stack.length>64)bad('XML構造サイズ上限');if(!m[3])stack.push(node);
  }
  if(stack.length!==1||root.children.some(c=>typeof c==='string'&&c.trim())||root.children.filter(c=>typeof c!=='string').length!==1)bad('XML文書構造');return root;
}
function all(node:X,uri:string,local:string):X[]{const out:X[]=[];for(const c of node.children)if(typeof c!=='string'){if(c.uri===uri&&c.local===local)out.push(c);out.push(...all(c,uri,local));}return out;}
function text(node:X):string{
  if(node.uri===TEXT&&node.local==='s'){const count=Object.entries(node.attrs).find(([k])=>k.split(':').pop()==='c')?.[1]||'1';if(!/^\d+$/.test(count)||+count>128)bad('空白長');return ' '.repeat(+count);}
  if(node.uri===TEXT&&(node.local==='tab'||node.local==='line-break'))return node.local==='tab'?'\t':'\n';
  return node.children.map(c=>typeof c==='string'?c:text(c)).join('');
}
export function twOdtPlainText(xml:string):string { return twOdtText(xml).trim(); }
export function twOdtText(xml:string):string {
  return all(xmlTree(xml),TEXT,'p').map(text).join('\n');
}
export function twOdtRows(xml:string):string[][]{
  return all(xmlTree(xml),TABLE,'table-row').map(row=>row.children.filter((c):c is X=>typeof c!=='string'&&c.uri===TABLE&&c.local==='table-cell').map(c=>all(c,TEXT,'p').map(text).join('\n').trim()));
}
export function twOdtContent(bytes:Uint8Array):string {
  if(bytes.byteLength>TW_ODT_MAX_ZIP||bytes.byteLength<22)bad('ZIPサイズ上限または不正');
  let entries=0,contents=0,declared=0;
  // Central-directory preflight never decompresses. Streaming below also counts actual output,
  // so a forged small uncompressed-size header cannot bypass the XML cap.
  unzipSync(bytes,{filter:f=>{
    if(++entries>128)bad('ZIP項目数上限');if(f.name!=='content.xml')return false;
    if(++contents!==1||f.originalSize>TW_ODT_MAX_XML||f.size>TW_ODT_MAX_ZIP)bad('content.xmlサイズまたは重複');declared=f.originalSize;return false;
  }});
  if(contents!==1)bad('content.xml欠落');
  const chunks:Uint8Array[]=[];let total=0,locals=0,complete=false;
  const stream=new Unzip(file=>{
    if(file.name!=='content.xml')return;
    if(++locals!==1||file.originalSize!==undefined&&file.originalSize>TW_ODT_MAX_XML)bad('content.xmlローカル項目不正');
    file.ondata=(error,data,final)=>{if(error)throw error;total+=data.byteLength;if(total>TW_ODT_MAX_XML)bad('展開済みXMLサイズ上限');chunks.push(data);if(final)complete=true;};file.start();
  });
  stream.register(UnzipInflate);
  for(let i=0;i<bytes.length;i+=1024)stream.push(bytes.subarray(i,Math.min(i+1024,bytes.length)),i+1024>=bytes.length);
  if(!complete||locals!==1||total!==declared)bad('content.xml展開サイズ不一致');
  const decoded=new Uint8Array(total);let offset=0;for(const c of chunks){decoded.set(c,offset);offset+=c.length;}
  const xml=strFromU8(decoded);if(xml.includes('\uFFFD'))bad('UTF8不正');return xml;
}
function checked(year:number,month:number,day:number,hour:number,minute:number):number{
  if(year<2000||year>2100||month<1||month>12||day<1||day>31||hour>23||minute>59)bad('日時範囲');
  const n=Date.UTC(year,month-1,day,hour,minute),d=new Date(n);if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)bad('不正な暦日');return n-8*3600000;
}
export function parseTwOdtXml(xml:string):{points:Point[];periods:Array<{start:number;end:number}>;rawText:string}{
  const rows=twOdtRows(xml),hazards:string[]=[],times:string[]=[];
  for(const row of rows)for(let i=0;i<row.length-1;i++){
    const label=row[i].replace(/\s/g,'');
    if(label.includes('HazardZone')&&label.includes('Latitude')&&label.includes('WGS84')&&!/Center|Chart|中心|圖/.test(label))hazards.push(row[i+1]);
    if(label.includes('ScheduledTime')&&label.includes('射擊時間'))times.push(row[i+1]);
  }
  if(hazards.length!==1||times.length!==1)bad('対応する区域・日程セルが一意でない');
  const hazard=hazards[0],schedule=times[0];if(!/WGS\s*84/i.test(hazard))bad('WGS84が未確認');
  const lines=hazard.split('\n').map(s=>s.trim()).filter(s=>s&&!/^※?\s*WGS\s*84$/i.test(s));const points:Point[]=[];
  for(const [i,line]of lines.entries()){
    const m=line.match(/^([A-Z])\s*[：:]\s*Lat\.\s*(\d{1,2})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*['′]\s*N\.?\s*Long\.\s*(\d{1,3})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*['′]\s*E\.?$/i);
    if(!m||m[1].toUpperCase()!==String.fromCharCode(65+i)||+m[3]>=60||+m[5]>=60)bad('未対応または不正な頂点');
    const p:Point=[+m[2]+ +m[3]/60,+m[4]+ +m[5]/60];if(p[0]>90||p[1]>180)bad('座標範囲');points.push(p);
  }
  if(points.length<3||points.length>12||new Set(points.map(p=>p.join(','))).size!==points.length)bad('頂点数または重複');
  let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a[1]*b[0]-b[1]*a[0];}if(Math.abs(area)<1e-10)bad('区域面積ゼロ');
  // Strict convex polygon family: reject crossing or ambiguous concave boundaries.
  const crosses=points.map((b,i)=>{const a=points[(i+points.length-1)%points.length],c=points[(i+1)%points.length];return (b[1]-a[1])*(c[0]-b[0])-(b[0]-a[0])*(c[1]-b[1]);});
  if(crosses.some(x=>Math.abs(x)<1e-12)||crosses.some(x=>x*crosses[0]<0))bad('非凸または交差区域');
  const orient=(a:Point,b:Point,c:Point)=>(b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1]);
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    if(j===i+1||i===0&&j===points.length-1)continue;
    const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
    if(orient(a,b,c)*orient(a,b,d)<=0&&orient(c,d,a)*orient(c,d,b)<=0)bad('交差する区域境界');
  }
  if(!/\(\s*UTC\s*\+\s*8\s*\)/i.test(schedule)||/UTC\s*(?:[-]|\+\s*(?!8\b)\d)/i.test(schedule)||/取消|修正|除外|預備|延期|每日|每天|至另|cancell|except|alternate|daily|further/i.test(schedule))bad('明示UTC+8でないか複雑な日程');
  const dateLines=schedule.split('\n').map(s=>s.trim()).filter(s=>/年.*月.*日/.test(s));
  if(!dateLines.length||dateLines.length>32)bad('対応する日程なし');
  const periods=dateLines.map(line=>{
    const m=line.match(/^(\d{3})年\s*(\d{1,2})月\s*(\d{1,2})日[，,]\s*(\d{2})(\d{2})時至\s*(\d{2})(\d{2})時$/);
    if(!m)bad('未対応の日程行');const year=+m[1]+1911,start=checked(year,+m[2],+m[3],+m[4],+m[5]),end=checked(year,+m[2],+m[3],+m[6],+m[7]);if(end<=start)bad('翌日終了または不正な期間');return {start,end};
  });
  if(new Set(periods.map(p=>p.start)).size!==periods.length)bad('重複日程');periods.sort((a,b)=>a.start-b.start);
  // English dates and clocks are corroborating fields. Reject disagreement, rather than ignoring it.
  const english=[...schedule.matchAll(/(\d{4})Hr\s*to\s*(\d{4})Hr\s*\(\s*UTC\s*\+\s*8\s*\)/gi)];
  if(english.length!==periods.length)bad('英語時刻との照合不能');
  for(let i=0;i<english.length;i++){const m=dateLines[i].match(/(\d{4})時至\s*(\d{4})時$/)!;if(m[1]!==english[i][1]||m[2]!==english[i][2])bad('日英時刻が不一致');}
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const enDates=[...schedule.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2})\s+(\d{4})\b/gi)];
  if(enDates.length!==dateLines.length)bad('英語年月日との照合不能');
  for(let i=0;i<enDates.length;i++){const m=dateLines[i].match(/^(\d{3})年\s*(\d+)月\s*(\d+)日/)!;if(+m[1]+1911!==+enDates[i][3]||+m[2]!==months.findIndex(x=>x.toLowerCase()===enDates[i][1].toLowerCase())+1||+m[3]!==+enDates[i][2])bad('日英年月日が不一致');}
  const interpreted=parseTwTimeWindows(dateLines.join('\n')+' UTC+8',{defaultCalendar:{calendar:'ROC',source:'native ODT Scheduled Time cell',evidence:'Three-digit Chinese calendar years corroborated against each explicit Gregorian English date in the same cell'}});
  if(!interpreted.periods.length||interpreted.periods.length!==periods.length||interpreted.periods.some((p,i)=>p.start!==periods[i].start||p.end!==periods[i].end))bad('独立した日程の意味解析が一致しません');
  return {points,periods:interpreted.periods.map(({start,end})=>({start,end})),rawText:twOdtText(xml)};
}
export function enrichTwOdtNotice(notice:Notice,bytes:Uint8Array,documentUrl:string):Notice {
  const u=new URL(documentUrl);if(u.protocol!=='https:'||u.hostname!=='www.fa.gov.tw')bad('公式添付URL以外');
  const result=parseTwOdtXml(twOdtContent(bytes));
  return {...notice,start:result.periods[0].start,end:result.periods[result.periods.length-1].end,validityPeriods:result.periods,timeUncertain:false,
    shapes:[{kind:'polygon',points:result.points,inferredClose:true,provenance:'text',sourceReference:documentUrl}],
    text:`${notice.text}\n\nODT原文: ${documentUrl}\n${result.rawText}`,
    warnings:[...notice.warnings.filter(w=>!w.startsWith('未解析：')),'ODT対応様式のみ解析：WGS84頂点と明示UTC+8日程。中心点・半径・武器射程は区域や高度に転用していません。','PDF・他のODT様式や原文の更新・取消の網羅は未確認。航行・飛行判断は最新の公式原文を確認してください。']};
}

// Geometry is independently readable even when a fully reviewed document's
// schedule lacks an interpretable clock/zone. No active period follows from it.
export function parseTwOdtGeometry(xml:string):{points:Point[];rawText:string}{
 const hazards:string[]=[];
 for(const row of twOdtRows(xml))for(let i=0;i<row.length-1;i++){const label=row[i].replace(/\s/g,'');if(label.includes('HazardZone')&&label.includes('Latitude')&&label.includes('WGS84')&&!/Center|Chart|中心|圖/.test(label))hazards.push(row[i+1]);}
 if(hazards.length!==1)bad('対応する危険区域が一意でない');
 const hazard=hazards[0];if(!/WGS\s*84/i.test(hazard))bad('WGS84が未確認');
 const lines=hazard.split('\n').map(s=>s.trim()).filter(s=>s&&!/^※?\s*WGS\s*84$/i.test(s));const points:Point[]=[];
  for(const [i,line]of lines.entries()){
    const m=line.match(/^([A-Z])\s*[：:]\s*Lat\.\s*(\d{1,2})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*['′]\s*N\.?\s*Long\.\s*(\d{1,3})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*['′]\s*E\.?$/i);
    if(!m||m[1].toUpperCase()!==String.fromCharCode(65+i)||+m[3]>=60||+m[5]>=60)bad('未対応または不正な頂点');
    const p:Point=[+m[2]+ +m[3]/60,+m[4]+ +m[5]/60];if(p[0]>90||p[1]>180)bad('座標範囲');points.push(p);
  }
  if(points.length<3||points.length>12||new Set(points.map(p=>p.join(','))).size!==points.length)bad('頂点数または重複');
  let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a[1]*b[0]-b[1]*a[0];}if(Math.abs(area)<1e-10)bad('区域面積ゼロ');
  // Strict convex polygon family: reject crossing or ambiguous concave boundaries.
  const crosses=points.map((b,i)=>{const a=points[(i+points.length-1)%points.length],c=points[(i+1)%points.length];return (b[1]-a[1])*(c[0]-b[0])-(b[0]-a[0])*(c[1]-b[1]);});
  if(crosses.some(x=>Math.abs(x)<1e-12)||crosses.some(x=>x*crosses[0]<0))bad('非凸または交差区域');
  const orient=(a:Point,b:Point,c:Point)=>(b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1]);
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    if(j===i+1||i===0&&j===points.length-1)continue;
    const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
    if(orient(a,b,c)*orient(a,b,d)<=0&&orient(c,d,a)*orient(c,d,b)<=0)bad('交差する区域境界');
  }

 return {points,rawText:twOdtText(xml)};
}

// Recover only explicit native WGS84 hazard-cell coordinates. No generic number
// search, geocoding, circle construction, vertex interpolation or closing edge.
// Missing/malformed vertices break the run so adjacent surviving points are not
// connected across an unread boundary. Other cells (contacts/centres/charts) are excluded.
function partialHazardGeometry(hazard:string):Shape[]{
 const shapes:Shape[]=[];if(!/WGS\s*84/i.test(hazard))return shapes;
 let run:Point[]=[],lastLabel=-1;
 const flush=()=>{if(run.length)shapes.push({kind:run.length>1?'line':'point',points:run,provenance:'text',partialBoundary:true,approx:true});run=[];lastLabel=-1;};
 for(const line of hazard.split('\n').map(s=>s.trim()).filter(s=>s&&!/^※?\s*WGS\s*84$/i.test(s))){
  const m=line.match(/^([A-Z])\s*[：:]\s*Lat\.\s*(\d{1,2})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*['′]\s*N\.?\s*Long\.\s*(\d{1,3})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*['′]\s*E\.?$/i);
  if(!m||+m[3]>=60||+m[5]>=60){flush();continue;}
  const point:Point=[+m[2]+ +m[3]/60,+m[4]+ +m[5]/60],ordinal=m[1].toUpperCase().charCodeAt(0);
  if(point[0]>90||point[1]>180){flush();continue;}
  if(lastLabel>=0&&(ordinal!==lastLabel+1||run.some(p=>p[0]===point[0]&&p[1]===point[1])))flush();
  run.push(point);lastLabel=ordinal;
 }
 flush();return shapes;
}
export function parseTwOdtPartialGeometry(xml:string):Shape[]{
 const shapes:Shape[]=[];
 for(const row of twOdtRows(xml))for(let i=0;i<row.length-1;i++){
  const label=row[i].replace(/\s/g,'');
  if(label.includes('HazardZone')&&label.includes('Latitude')&&label.includes('WGS84')&&!/Center|Chart|中心|圖/.test(label))shapes.push(...partialHazardGeometry(row[i+1]));
 }
 const all=[...shapes,...parseTwOdtTextPartialGeometry(twOdtText(xml))];
 return [...new Map(all.map(shape=>[JSON.stringify(shape),shape])).values()].slice(0,64);
}
// Old private caches retain native text, not ZIP bytes. Recover just the explicit
// labelled hazard-cell vertex block; stop before centre/radius/chart/contact cells.
export function parseTwOdtTextPartialGeometry(text:string):Shape[]{
 if(text.length>TW_ODT_MAX_XML)return [];
 const shapes:Shape[]=[];
 for(const marker of text.matchAll(/^Hazard[ \t]+Zone[ \t]*$/gm)){
  const tail=text.slice(marker.index!+marker[0].length,marker.index!+4096),header=tail.match(/^[\s\S]{0,160}?Latitude[\s\S]{0,100}?WGS\s*84/i);
  if(!header)continue;
  const lines=tail.slice(header[0].length).split('\n'),vertices:string[]=[];let started=false;
  for(const raw of lines){const line=raw.trim();if(!line)continue;if(/^[A-Z]\s*[：:]/.test(line)){started=true;vertices.push(line);}else if(started)break;else if(!/^※?\s*WGS\s*84$/i.test(line))break;}
  shapes.push(...partialHazardGeometry('WGS84\n'+vertices.join('\n')));
 }
 // A second existing native family uses a Position block with explicit DMS
 // hemispheres and WGS84. Retain separate points: ordering alone is not closure.
 for(const marker of text.matchAll(/^Position[ \t]*:[ \t]*$/gmi)){
  const lines=text.slice(marker.index!+marker[0].length,marker.index!+4096).split('\n'),block:string[]=[];let started=false;
  for(const raw of lines){const line=raw.trim();if(!line)continue;if(/^\d{1,2}\s*°/.test(line)||/^\*?\s*WGS\s*84$/i.test(line)){started=true;block.push(line);}else if(started)break;else break;}
  if(!/WGS\s*84/i.test(block.join(' ')))continue;
  for(const line of block){
   const m=line.match(/^(\d{1,2})\s*°\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)\s*["”″]\s*([NS])\s*[,，]\s*(\d{1,3})\s*°\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)\s*["”″]\s*([EW])(?:\s*[*.]?\s*WGS\s*84)?[.。]?$/i);
   if(!m||[m[2],m[3],m[6],m[7]].some(x=>+x>=60))continue;
   const latitude=(+m[1]+ +m[2]/60+ +m[3]/3600)*(m[4].toUpperCase()==='S'?-1:1),longitude=(+m[5]+ +m[6]/60+ +m[7]/3600)*(m[8].toUpperCase()==='W'?-1:1);
   if(Math.abs(latitude)>90||Math.abs(longitude)>180)continue;
   shapes.push({kind:'point',points:[[latitude,longitude]],provenance:'text',partialBoundary:true,approx:true});
  }
 }
 return shapes.slice(0,64);
}
