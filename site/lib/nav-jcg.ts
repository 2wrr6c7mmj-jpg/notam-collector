import { jcgPrimaryWithAlternates } from './nav-english-utc-periods';
import type { Notice, Shape, Point } from './notam';
import type { NavSource } from './nav-sources';
import type { SourceRecord } from './nav-store';

export const jcgSource: NavSource = { id: 'jcg-navarea11', name: '海上保安庁 NAVAREA XI', region: '北太平洋西部・東南アジア', country: 'JP', parser: 'jcg-navarea11', url: 'https://www1.kaiho.mlit.go.jp/TUHO/keiho/navarea11.html' };
const ROOT = 'https://www1.kaiho.mlit.go.jp/TUHO/keiho/cgi/';
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
export const militaryNav = /\b(?:MILITARY|NAVAL\s+EXERCISE|EXERCISES?|GUNNERY|FIRING|LAUNCH(?:ING)?|MISSILES?|ROCKETS?|SPACE\s+DEBRIS|BOMB(?:ING)?|LIVE[ -]?FIRE)\b|軍事|軍事演習|演習|訓練|射撃|射擊|実弾|實彈|ロケット|ミサイル|打上|発射|發射|火箭/i;
function decode(s: string) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):+n)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&'); }
export function jcgList(xml: string) {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<opt(?:\s[^>]*)?>[\s\S]*<\/opt>\s*$/.test(xml)) throw new Error('JCG XML schema unrecognized');
  return [...xml.matchAll(/<Member>([\s\S]*?)<\/Member>/g)].map(m=> {
    const field=(key:string)=>decode(m[1].match(new RegExp(`<${key}>([\\s\\S]*?)</${key}>`))?.[1] || '').trim();
    const tana=field('tana'); if(!/^\d{6}$/.test(tana)) throw new Error('JCG warning identifier invalid');
    return { tana, title:field('title'), category:field('categoly'), url:`${ROOT}disp_warnings.cgi?TYPE=NAVAREA11&TANA=${tana}&LANG=JP` };
  });
}
// Source-specific D-M / D-M-S parser: unlike generic normalization, validates each component before joining.
export function jcgCoordinates(text:string):Point[] {
  const points:Point[]=[];
  for(const m of text.matchAll(/\b(\d{1,2})-(\d{2}(?:\.\d+)?)(?:-(\d{2}(?:\.\d+)?))?([NS])\s+(\d{1,3})-(\d{2}(?:\.\d+)?)(?:-(\d{2}(?:\.\d+)?))?([EW])\b/g)) {
    if(+m[2]>=60 || +(m[3]||0)>=60 || +m[6]>=60 || +(m[7]||0)>=60) continue;
    const lat=+m[1]+ +m[2]/60+ +(m[3]||0)/3600, lon=+m[5]+ +m[6]/60+ +(m[7]||0)/3600;
    if(lat<=90 && lon<=180) points.push([lat*(m[4]==='S'?-1:1),lon*(m[8]==='W'?-1:1)]);
  } return points;
}
export function jcgShapes(text:string):Shape[] {
  const bounded=/\bAREAS? BOUND(?:ED)? BY\b/.test(text);
  // Separate lettered areas, never connect distinct polygons.
  const chunks=text.split(/(?:^|\n)\s*[A-Z]\.\s+(?=\d{1,2}-\d{2})/);
  return chunks.flatMap(chunk=> {
    const pts=jcgCoordinates(chunk); if(!pts.length) return [];
    const complex=/\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS)\b/.test(text) || /\b(?:RADIUS|ARC|EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS|COAST|SHORE|WITHIN|MILES?|CIRCLE)\b/.test(chunk);
    if(bounded && pts.length>=3 && !complex) return [{kind:'polygon',points:pts,inferredClose:true,provenance:'text'} as Shape];
    return pts.map(p=>({kind:'point',points:[p],provenance:'text'} as Shape));
  });
}
function checked(year:number,month:number,day:number,hour:number,minute:number) {
  if(hour>23||minute>59||month<0||month>11) return null;
  const t=Date.UTC(year,month,day,hour,minute),d=new Date(t);
  return d.getUTCFullYear()===year&&d.getUTCMonth()===month&&d.getUTCDate()===day?t:null;
}
export function jcgDates(text:string,postedAt:number|null):{start:number|null;end:number|null;warnings:string[]} {
  const warnings:string[]=[];
  // Cancellation date is deliberately excluded: it is not operation end.
  const activity=text.split(/\bCANCEL THIS MSG\b/)[0];
  if(!postedAt || /\b(?:DAILY|ALTERNATE|EXC|EXCL|EXCLUD(?:E|ED|ING)|EXCEPT|INTERMITTENT|UNTIL FURTHER|COMMENCING)\b/.test(activity)) return {start:null,end:null,warnings:['活動時間は反復・予備日・未確定条件を含むか未解析です。原文のUTC日程を確認してください。']};
  const m=activity.match(/\b(\d{2})(\d{2})(\d{2})Z\s+TO\s+(\d{2})(\d{2})(\d{2})Z\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/);
  if(!m) return {start:null,end:null,warnings:['活動期間を安全に解析できません。原文を確認してください。']};
  const year=new Date(postedAt).getUTCFullYear(), month=MONTHS.indexOf(m[7]);
  // Resolve month relative to publication; prevent accidental next/previous-year guesses.
  if(Math.abs(month-new Date(postedAt).getUTCMonth())>2) return {start:null,end:null,warnings:['活動年の照合が必要です。']};
  const start=checked(year,month,+m[1],+m[2],+m[3]),end=checked(year,month,+m[4],+m[5],+m[6]);
  if(start===null||end===null||end<start) return {start:null,end:null,warnings:['活動期間の年月日が不明確です。']};
  return {start,end,warnings};
}
export function jcgValidity(text:string,postedAt:number|null) {
  const primary = jcgPrimaryWithAlternates(text,postedAt);
  if(primary) return primary;
  const dates=jcgDates(text,postedAt);
  const base={...dates,validityPeriods:dates.start!==null&&dates.end!==null?[{start:dates.start,end:dates.end}]:[],timeUncertain:dates.start===null||dates.end===null};
  if(!postedAt||/\b(?:ALTERNATE|EXC|EXCL|EXCLUD(?:E|ED|ING)|EXCEPT|INTERMITTENT)\b/.test(text)) return base;
  const m=text.match(/\b(\d{2})(\d{2})Z TO (\d{2})(\d{2})Z COMMENCING DAILY\s+(\d{2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) TO (\d{2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/);
  if(!m) return base;
  const year=new Date(postedAt).getUTCFullYear(),a=checked(year,MONTHS.indexOf(m[6]),+m[5],0,0),b=checked(year,MONTHS.indexOf(m[8]),+m[7],0,0);
  if(a===null||b===null||b<a||b-a>93*86400000||+m[1]>23||+m[3]>23||+m[2]>59||+m[4]>59) return base;
  const validityPeriods:Array<{start:number;end:number}>=[];
  for(let day=a;day<=b;day+=86400000){const start=day+(+m[1]*60+ +m[2])*60000;let end=day+(+m[3]*60+ +m[4])*60000;if(end<=start)end+=86400000;validityPeriods.push({start,end});}
  return {start:validityPeriods[0].start,end:validityPeriods[validityPeriods.length-1].end,validityPeriods,timeUncertain:false,warnings:['日毎の開始時刻から終了時刻までのUTC区間として解析。終了時刻が開始時刻より前なら翌日終了。']};
}
export function parseJcgDetail(html:string,url:string,title=''):Notice {
  const raw=decode(html.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'')).replace(/\r/g,'');
  const number=raw.match(/NO\.(\d{2}-\d{4})/); if(!number) throw new Error('JCG detail warning number missing');
  const p=raw.match(/発表日時[：:]\s*(\d{4})年(\d{2})月(\d{2})日\s*(\d{2})時/);
  // Website explicitly says hourly posting time, not precise radio issue time; keep labeled in warnings.
  const local=p?checked(+p[1],+p[2]-1,+p[3],+p[4],0):null,issued=local===null?null:local-9*3600000;
  const text=raw.slice(raw.indexOf('NO.')).trim(), dates=jcgValidity(text,issued),shapes=jcgShapes(text);
  return {id:`NAVAREA XI ${number[1]}`,location:title || 'NAVAREA XI',text,issued,start:dates.start,end:dates.end,permanent:false,validityPeriods:dates.validityPeriods,timeUncertain:dates.timeUncertain,purpose:militaryNav.test(title+'\n'+text)?'firing':'other',shapes,warnings:[...dates.warnings,...(/\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS)\b/i.test(text)?['除外条件を含むため区域は未確定です。座標のみ表示します。']:[]),'発表日時はJCGサイトの掲載時刻（JST、1時間単位）です。正確な発信時刻ではありません。','日本はNAVAREA XIの公表・調整国です。活動実施国・海域の主権を示しません。',...(!shapes.length?['描画可能な座標なし']:[])],sourceUrl:url,sourceName:jcgSource.name,sourceCountry:'JP'};
}
export async function collectJcgSource(source:NavSource,previous:SourceRecord,fetcher:typeof fetch=fetch):Promise<SourceRecord> {
  const checkedAt=Date.now(),deadline=checkedAt+24000; let pages=0,failed=0,requests=0,detailAttempts=0,successfulDetails=0;
  const items=new Map(previous.items.map(n=>[n.id,n]));
  const failures = new Set<string>();
  let state:{years:string[];cursor:number}={years:[],cursor:1};
  try { const saved=JSON.parse(previous.continuation||'{}');if(Array.isArray(saved.years)&&saved.years.every((y:unknown)=>typeof y==='string'&&/^\d{4}$/.test(y))&&Number.isInteger(saved.cursor)) state=saved;}catch{}
  async function get(url:string,body?:string) {
    if(requests++>=48) throw new Error('JCG request budget exhausted');
    const response=await fetcher(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}:{Accept:'text/html,application/xml'},body,signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-Date.now())))});
    if(!response.ok) {
      const path = new URL(url).pathname;
      const stage = path.endsWith('disp_warnings.cgi') ? '本文' : body ? '年別一覧' : '公表ページ';
      const detail = `${stage}: ${response.status === 403 ? '配信元がアクセスを拒否' : '取得失敗'}（HTTP ${response.status}、${path}）`;
      failures.add(detail);
      throw new Error(detail);
    }
    if(response.url&&new URL(response.url).hostname!=='www1.kaiho.mlit.go.jp') throw new Error('JCG unexpected redirect');
    const text=await response.text();if(text.length>2000000) throw new Error('JCG payload too large');pages++;return text;
  }
  async function year(year:string,refreshNewest:boolean) {
    const list=jcgList(await get(`${ROOT}warnings.cgi`,`YEAR=${year}&TYPE=NAVAREA11&LANG=JP`));
    // Only a complete successful index for this exact year can retire that year's cached items.
    const listed=new Set(list.map(n=>n.url));
    for(const [id,n] of items) if(id.startsWith(`NAVAREA XI ${year.slice(2)}-`)&&!listed.has(n.sourceUrl||'')) items.delete(id);
    list.sort((a,b)=>Number(militaryNav.test(b.title))-Number(militaryNav.test(a.title))||b.tana.localeCompare(a.tana));
    const known=new Set([...items.values()].map(n=>n.sourceUrl));
    const pending=list.filter((n,i)=>!known.has(n.url)||(refreshNewest&&i<2));let incomplete=0;
    for(let i=0;i<pending.length;i+=4){
      if(Date.now()>deadline-1500||detailAttempts>=40){incomplete+=pending.length-i;break;}
      await Promise.all(pending.slice(i,i+4).map(async n=>{detailAttempts++;try{const notice=parseJcgDetail(await get(n.url),n.url,n.title);items.set(notice.id,notice);successfulDetails++;}catch{incomplete++;}}));
    }
    failed+=incomplete;return incomplete===0;
  }
  try {
    const current=String(new Date(checkedAt).getUTCFullYear());
    if(!state.years.includes(current)){
      const index=await get(source.url);state={years:[...new Set([...index.matchAll(/id="yearlylist_(\d{4})"/g)].map(m=>m[1]))].sort().reverse(),cursor:1};
      if(!state.years.length) throw new Error('JCG year listing missing');
    }
    if(state.cursor>=state.years.length) state.cursor=1;
    const currentComplete=await year(state.years[0],true);
    // Current warnings take priority; each later run advances one older-year index with cached details.
    if(currentComplete&&state.cursor<state.years.length&&Date.now()<deadline-5000){
      try{if(await year(state.years[state.cursor],false))state.cursor++;}catch{failed++;}
    }
    const backlog=state.cursor<state.years.length;
    const result=[...items.values()];
    return {items:result,revision:1,continuation:JSON.stringify(state),status:{...source,state:failed||backlog?'partial':'ok',checkedAt,fetchedAt:successfulDetails?checkedAt:previous.status.fetchedAt,count:result.length,pages,detail:`NAVAREA XI当年優先取得。${[...failures].join('。')}${failures.size?'。':''}${failed?`${failed}件未取得。`:''}${backlog?`過年度は${state.cursor}/${state.years.length-1}年目を順次取得中。`:''}未確認年の前回データを保持。2016年以前・各国沿岸警報は対象外。日本は公表・調整国。`}};
  }catch(error){return {...previous,items:[...items.values()],continuation:JSON.stringify(state),status:{...previous.status,...source,state:'error',checkedAt,count:items.size,pages,detail:`${error instanceof Error?error.message:'JCG取得失敗'}。警告の有無は不明。前回データを保持。`}};}
}
