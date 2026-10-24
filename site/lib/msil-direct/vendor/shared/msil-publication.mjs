// Publication headers only. Body clocks (activity, observation, quoted warnings)
// and collection receipts must never become this warning's publication time.
const HOUR=3600000,DAY=24*HOUR;
const normalize=s=>String(s||'').normalize('NFKC').replace(/[−―‐–—－]/g,'-').trim();
const OFFICIAL='https://www1.kaiho.mlit.go.jp/TUHO/keiho/';
const unknown=(raw=null,reason='publication-header-missing')=>({issued:null,publicationEvidence:{raw,kind:'unknown',precision:'unknown',reason}});
function header(item){
 const identity=item.identity||item.msilIdentity||'',lines=normalize(item.text).split('\n').map(s=>s.trim()).filter(Boolean);
 const standard=identity.match(/^(NAVAREA航行警報|NAVTEX航行警報|日本航行警報):(\d{2,4}-\d+)$/);
 if(standard){
  if(lines[0]!==`${standard[1]}:${standard[2]}`)return null;
  const raw=lines[1]?.match(/^発表日時\s*:\s*(.+)$/)?.[1];
  return raw?{raw,kind:'site-publication',year:null,url:OFFICIAL+({NAVAREA航行警報:'navarea11',NAVTEX航行警報:'navtex',日本航行警報:'japan_nw'}[standard[1]])+'.html'}:null;
 }
 const district=identity.match(/^([一二三四五六七八九十]+管区地域航行警報):(\d{2})-(\d{2})(\d{4})$/);
 if(!district)return null;
 const ownHeader=new RegExp(`^(?:(?:航路標識|仮灯設置|障害物)[、,]\\s*)?第?${district[1]}\\s*番号\\s*\\d+`);
 const i=lines.slice(0,4).findIndex(l=>ownHeader.test(l));if(i<0)return null;
 // Only reviewed provider category headings may precede the own-warning header.
 if(lines.slice(0,i).some(l=>!/^(?:航路標識|仮灯設置|障害物|水深|沈船|射撃|訓練|漂流物|港湾施設)[、,]?$/.test(l)))return null;
 const match=lines[i].match(/番号\s*(\d+)\s*[、,]?\s*(.*)$/);if(!match||+match[1]!==+district[4])return null;
 const tail=match[2]||lines[i+1]||'';
 if(!match[2]&&!/発表[、,]?$/.test(tail))return null;
 // A date must immediately follow this warning's own header; never search body.
 const raw=tail.match(/^((?:\d{4}年)?\d{1,2}月\d{1,2}日[^、,]*)/)?.[1];
 return raw?{raw,kind:'warning-publication',year:2000+ +district[3],url:OFFICIAL+`kanku/${district[2]}kanku.html`}:null;
}
function clock(raw,year){
 // Accept only a complete publication value. Trailing observation/activity text
 // or an unrecognised zone makes it unresolved rather than partially parsed.
 const m=normalize(raw).match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(?:(\d{1,2})時(?:\s*(\d{1,2})分)?|(\d{2})(\d{2}))?\s*(?:(UTC|GMT|JST|KST|日本時間|日本標準時|協定世界時|世界時)(?:\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?)?)?\s*(?:発表)?\s*$/i);
 if(!m)return null;
 const y=m[1]?+m[1]:year;if(!y||y<1900||y>2199)return null;
 const mon=+m[2],day=+m[3],hour=m[4]===undefined?+(m[6]||0):+m[4],minute=m[5]===undefined?+(m[7]||0):+m[5];
 const t=Date.UTC(y,mon-1,day,hour,minute),d=new Date(t);
 if(d.getUTCFullYear()!==y||d.getUTCMonth()!==mon-1||d.getUTCDate()!==day||d.getUTCHours()!==hour||d.getUTCMinutes()!==minute)return null;
 const precision=m[4]!==undefined?(m[5]!==undefined?'minute':'hour'):m[6]!==undefined?'minute':'date';
 let offset=540,zone='JST',basis='jcg-japanese-publication-header-jst';
 if(m[8]){basis='explicit-publication-header';const z=m[8].toUpperCase();offset=/^(UTC|GMT|協定世界時|世界時)$/.test(z)?0:540;zone=offset?'JST':'UTC';
  if(m[9]){if(!/^(UTC|GMT)$/.test(z)||+m[10]>14||+(m[11]||0)>59||(+m[10]===14&&+(m[11]||0)))return null;offset=(m[9]==='-'?-1:1)*(+m[10]*60+ +(m[11]||0));zone=`UTC${m[9]}${String(m[10]).padStart(2,'0')}:${String(m[11]||0).padStart(2,'0')}`;}
  else if(z==='KST')zone='KST';
 }
 return {start:t-offset*60000,precision,date:`${y}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`,zone,zoneBasis:basis,yearBasis:m[1]?'explicit-header':'warning-identity-year'};
}
export function parseMsilPublication(item){
 const h=header(item);if(!h)return unknown();
 const parsed=clock(h.raw,h.year);if(!parsed||h.year&&Number(parsed.date.slice(0,4))!==h.year)return unknown(h.raw,'invalid-publication-header');
 const {start,...e}=parsed,span={date:DAY,hour:HOUR,minute:60000}[e.precision];
 return {issued:e.precision==='date'?null:start,publicationEvidence:{...e,raw:h.raw,kind:h.kind,rangeStart:start,rangeEnd:start+span,sourceUrl:h.url,
  disclosure:h.kind==='site-publication'?'海保サイトの掲載時刻です。正確な警報発出時刻とは異なります。':'この地域航行警報の発表ヘッダーです。',
  ...(e.yearBasis==='warning-identity-year'?{yearDisclosure:'省略された年はこの警報番号の発信年から補っています。'}:{})}};
}
export function withMsilPublication(item){return /^(?:(?:NAVAREA|NAVTEX|日本)航行警報|[一二三四五六七八九十]+管区地域航行警報):/.test(item?.msilIdentity||'')?{...item,...parseMsilPublication(item)}:item;}
export function publicationLabel(item){
 const e=item?.publicationEvidence;if(!e)return '';
 if(e.precision==='unknown')return '発表日時：確認できません';
 const prefix=e.kind==='site-publication'?'掲載日時':'発表日時';
 if(e.precision==='date')return `${prefix}：${e.date.replaceAll('-','/')}（日付のみ・${e.zone}）`;
 const d=new Date(e.rangeStart+9*HOUR),pad=n=>String(n).padStart(2,'0');
 const date=`${d.getUTCFullYear()}/${d.getUTCMonth()+1}/${d.getUTCDate()} ${pad(d.getUTCHours())}`;
 if(e.precision==='hour'&&d.getUTCMinutes()){const end=new Date(e.rangeEnd+9*HOUR);return `${prefix}：${date}:${pad(d.getUTCMinutes())} ～ ${end.getUTCFullYear()}/${end.getUTCMonth()+1}/${end.getUTCDate()} ${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}（原文は時単位・JST）`;}
 const clock=e.precision==='hour'?`${date}時`:`${date}:${pad(d.getUTCMinutes())}`;
 return `${prefix}：${clock}${e.precision==='hour'?'（時単位・JST）':'（JST）'}`;
}
export function publicationDetails(item){const e=item?.publicationEvidence;return e?[e.disclosure,e.precision==='date'?'原文は日付のみです。時刻は補っていません。':e.precision==='hour'?'原文は時単位です。分・秒は補っていません。':null,e.yearDisclosure,e.zoneBasis==='jcg-japanese-publication-header-jst'?'無印の日本語発表ヘッダーは海保の掲載運用に基づき日本時間として扱います。本文の時区とは分けています。':null].filter(Boolean):[];}
export function publicationWithin(item,now,hours){
 if(!Number.isFinite(now)||!Number.isFinite(hours)||hours<=0)return false;
 const e=item?.publicationEvidence;
 if(e){return Number.isFinite(e.rangeStart)&&Number.isFinite(e.rangeEnd)&&e.rangeStart<=now&&e.rangeEnd>now-hours*HOUR;}
 return Number.isFinite(item?.issued)&&item.issued<=now&&item.issued>=now-hours*HOUR;
}
export function sortByPublication(items){
 const key=n=>Number.isFinite(n.publicationEvidence?.rangeStart)?n.publicationEvidence.rangeStart:Number.isFinite(n.issued)?n.issued:-Infinity;
 return [...items].sort((a,b)=>key(b)-key(a));
}
