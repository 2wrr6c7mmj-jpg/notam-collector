import {englishUtcMaritimeAnalysis} from './nav-english-utc-periods';
import {navPeriodAnalysis} from './nav-period';
import {decodeHtml,navWarningToNotice,navPeriodWarnings} from './nav-warning';
import {MaritimeBudgetDeferred,type NavRequestBudget} from './nav-collection-budget';
import {legacyCancellationKeys} from './nav-ingest';
import {canonicalWarningNumber,warningNumber} from './nav-id';
import type {Notice} from './notam';
import type {NavSource,SourceStatus} from './nav-sources';
import type {SourceRecord} from './nav-store';

export const CHINA_FIRST_PAGE_IDS=new Set(['ln','tj','hb','sd','lyg','js','sh','zj','fj','gd','sz','gx','hn','cj','js-local','jx-local']);
export const CHINA_FIRST_PAGE_LIMITS={htmlBytes:1_000_000,bodyBytes:500_000,totalBytes:12_582_912,bodyRequests:46,concurrency:4,runMs:120_000,entries:500,sourceBytes:1_800_000};
export type PublicationEvidence={raw:string;date:string;precision:'day'|'minute'|'second';epoch:number|null;basis:'list-row'|'meta-pubdate'|'visible-publication';zone:string};
export type FirstPageEntry={url:string;title:string;position:number;rowIndex?:number;pageNumber?:1|2;etag?:string;lastModified?:string;bodyValidatedAt?:number;bodySha256?:string;cacheRevision?:number;metadataConflict?:boolean;publication:PublicationEvidence|null;status:'pending'|'read'|'failed'|'unsupported-link';detail?:string;bodyCheckedAt?:number;attemptedAt?:number;ownId?:string|null;groupKey?:string|null};
type Original={sourceUrl:string;title:string;text:string;publication:PublicationEvidence|null};
export type FirstPageNotice=Notice&{chinaFirstPage:{schemaVersion:1;sourceId:string;entryKey:string;title:string;ownId:string|null;references:string[];legacyCancellationKeys?:string[];kind:'notice'|'cancellation'|'bulletin';publication:PublicationEvidence|null;groupKey:string|null;originals:Original[];checkedAt:number}};
export type FirstPageState={schemaVersion:1;url:string;checkedAt:number;sha256:string;entries:FirstPageEntry[];complete:boolean;cursor:number;priorEntries:FirstPageEntry[];retryAfter?:number;listingCaches?:ListingCache[];listingScopeComplete?:boolean};
export type FirstPageRecord=SourceRecord&{collectionRetryAfter?:number;firstPage?:FirstPageState;deferredHistory?:{continuation?:string;pendingArticles?:string[];retryArticles?:string[]}};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join('');
const plain=(s:string)=>decodeHtml(s.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,''));
const sameOrigin=(url:string,base:string)=>{try{return new URL(url).origin===new URL(base).origin;}catch{return false;}};

export function publicationEvidence(raw:string,basis:PublicationEvidence['basis']):PublicationEvidence|null{
 const match=raw.trim().match(/^(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/);if(!match)return null;
 const [,y,m,d,h,min,sec,zone]=match,year=+y,month=+m,day=+d,hh=+(h||0),mm=+(min||0),ss=+(sec||0),check=new Date(Date.UTC(year,month-1,day,hh,mm,ss));
 if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||hh>23||mm>59||ss>59)return null;
 const date=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`,suffix=zone||'+08:00';if(zone&&zone!=='Z'&&(!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(zone)||/^[+-]14:(?!00)/.test(zone)))return null;
 const epoch=h===undefined?null:Date.parse(`${date}T${h.padStart(2,'0')}:${min}:${sec||'00'}${suffix}`);if(epoch!==null&&!Number.isFinite(epoch))return null;
 return {raw:raw.trim(),date,precision:h===undefined?'day':sec===undefined?'minute':'second',epoch,basis,zone:zone||'UTC+8 app convention; source timezone unmarked'};
}
const dateToken=/(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?)/;
// Dates in titles can describe the activity, rather than publication. Only a
// separate date-only element in a registered regional row is a fallback.
const regionalColumns:Record<string,string>={
 ln:'c8896863b1014c438705536a03eb46ff',tj:'bdba5fad6e5d48679f970fcf8efb8636',
 hb:'93b73989d22045f9bc3270a6eba35180',sd:'36ea3354c8f84953aba082d6d989c750',
 lyg:'fa4501f3dbe44f70bc726f27132d4e04',js:'b5b0f3c7630d4967b1e6b06208575d15',
 sh:'94df14ce1110415da44e67593e76619f',zj:'8e10ea74eb9e4c9690f8f891968add80',
 fj:'7b08405760384570a0fb44e9204c4b1d',gd:'1e478d409e854918bf12478b8a19f4a8',
 sz:'325fdc0892b44313a63ee5c165be98ec',gx:'86de2fffff2c47f98359fd1f20d6508f',
 hn:'d3340711057b494b8fa09eedc4c5ead9',cj:'9340423406cc4507b2fb8af2492d2a3d',
 'js-local':'d14ed012960b4064971270459a4a0d4d','jx-local':'html/cnmsa/hxaq/aqxx/hxjg/jxsdfhsju',
};
export const chinaRegionalListingProfiles=Object.fromEntries(Object.entries(regionalColumns).map(([id,column])=>[id,{id,url:`https://www.msa.gov.cn/${column}/index.${id==='jx-local'?'html':'jhtml'}`,dateElementFallback:true}])) as Record<string,{id:string;url:string;dateElementFallback:boolean}>;
function registeredDateElements(base:string){try{const u=new URL(base);return Object.values(chinaRegionalListingProfiles).some(p=>{const registered=new URL(p.url),folder=registered.pathname.slice(0,registered.pathname.lastIndexOf('/')+1);return registered.origin===u.origin&&u.pathname.startsWith(folder)&&/^index(?:_[12])?\.(?:jhtml|html)$/.test(u.pathname.slice(folder.length))&&p.dateElementFallback;});}catch{return false;}}
function dateElements(body:string):{markup:string;date:string}[]{
 const result:{markup:string;date:string}[]=[];
 for(const m of body.matchAll(/<(span|time)\b[^>]*>((?:(?!<(?:span|time)\b)[\s\S])*?)<\/\1>/gi)){
  const raw=plain(m[2]).trim();if(publicationEvidence(raw,'list-row'))result.push({markup:m[0],date:raw});
 }
 return result;
}
function rowPublication(body:string,allowElements:boolean){
 const outside=plain(body.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi,''));
 const dates=[...outside.matchAll(new RegExp(dateToken.source,'g'))].map(m=>m[1]);
 if(allowElements)dates.push(...dateElements(body).map(e=>e.date));
 const evidence=dates.map(d=>publicationEvidence(d,'list-row')).filter((e):e is PublicationEvidence=>!!e);
 const unique=new Map(evidence.map(e=>[`${e.date}|${e.precision}|${e.epoch}`,e]));
 return {hasDate:unique.size>0,publication:unique.size===1?[...unique.values()][0]:null};
}
function attrs(tag:string,name:string){return tag.match(new RegExp('\\b'+name+'\\s*=\\s*["\\\']([^"\\\']*)["\\\']','i'))?.[1]||'';}
function meta(html:string,name:string){return [...html.matchAll(/<meta\b[^>]*>/gi)].filter(m=>attrs(m[0],'name').toLowerCase()===name.toLowerCase()).map(m=>plain(attrs(m[0],'content')));}
function rowBodies(html:string){
 const stack:{tag:string;start:number;offset:number;excluded:boolean}[]=[],rows:{body:string;offset:number;end:number}[]=[],excluded:{start:number;end:number}[]=[];
 for(const m of html.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)){const tag=m[1].toLowerCase();if(/^<\//.test(m[0])){const i=stack.map(x=>x.tag).lastIndexOf(tag);if(i<0)continue;const n=stack[i];stack.length=i;if(n.excluded)excluded.push({start:n.offset,end:m.index+m[0].length});if(!n.excluded&&/^(li|tr|dl)$/.test(tag)){let body='',at=n.start;for(const x of excluded.filter(x=>x.start>=n.start&&x.end<=m.index).sort((a,b)=>a.start-b.start||b.end-a.end)){if(x.start<at)continue;body+=html.slice(at,x.start);at=x.end;}body+=html.slice(at,m.index);rows.push({body,offset:n.offset,end:m.index+m[0].length});}}
 else if(!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)&&!/\/\s*>$/.test(m[0])){const label=[attrs(m[0],'class'),attrs(m[0],'id'),attrs(m[0],'role')].join(' ');const hide=!!stack.at(-1)?.excluded||/^(script|style|nav|header|footer|aside)$/.test(tag)||/(?:^|[\s_-])(?:sidebar|side-nav|related|recommend|archive|footer|header|navigation|pagination)(?:[\s_-]|$)/i.test(label)||/display\s*:\s*none|visibility\s*:\s*hidden|\shidden(?:\s|=|>)|aria-hidden\s*=\s*["']true/i.test(m[0]);stack.push({tag,start:m.index+m[0].length,offset:m.index,excluded:hide});}}
 return rows.filter(r=>!rows.some(c=>c.offset>r.offset&&c.end<r.end)).sort((a,b)=>a.offset-b.offset);
}
// Select one structurally unambiguous list before preserving every row in it.
// This is a conservative inferred template, not proof that every live regional
// template is supported. Competing lists must be inspected instead of merged.
export type ChinaListingStructure={parsedContainers:number;visibleRows:number;datedLinkRows:number;outsideLinkDatedRows:number;insideLinkDateElementRows:number;matchingContainers:number;candidateContainers:number};
export type ChinaListingDiagnostic={pageNumber:1|2;httpStatus:number|null;contentType:'missing'|'text/html'|'application/xhtml+xml'|'application/json'|'text/plain'|'application/xml'|'text/xml'|'other';bytesRead:number;bodyKind:'unread'|'empty'|'html-like'|'json-like'|'text-like'|'restriction-marker';fromValidatedCache:boolean;phase:'budget'|'request'|'response'|'body'|'decode'|'access-check'|'list-parse'|'complete';outcome:'pending'|'accepted'|'failed';structure:ChinaListingStructure|null};
const officialAccessRestriction=(html:string)=>/ACCESS DENIED|<title[^>]*>\s*(?:安全验证|Access Denied|Just a moment)|机器人验证|verify you are human/i.test(html);
function listingContentType(value:string|null):ChinaListingDiagnostic['contentType']{
 const mime=value?.split(';',1)[0].trim().toLowerCase();
 return !mime?'missing':['text/html','application/xhtml+xml','application/json','text/plain','application/xml','text/xml'].includes(mime)?mime as ChinaListingDiagnostic['contentType']:'other';
}
// Prefix/marker heuristic only; never a claim that the content is valid HTML/JSON.
function listingBodyKind(html:string):ChinaListingDiagnostic['bodyKind']{
 if(officialAccessRestriction(html))return 'restriction-marker';
 const text=html.trim();return !text?'empty':/^\s*(?:<!doctype\b|<(?:html|head|body|title|div|main|ul|ol|table|dl|li|article|meta|script)\b)/i.test(text)?'html-like':/^[{[]/.test(text)?'json-like':'text-like';
}

function listingFailureReason(diagnostic:ChinaListingDiagnostic){
 if([401,403,429].includes(diagnostic.httpStatus||0))return 'HTTP_ACCESS_RESTRICTED';
 if(diagnostic.httpStatus===503)return 'HTTP_SERVICE_UNAVAILABLE';
 if(diagnostic.httpStatus!==null&&diagnostic.httpStatus>=400)return 'HTTP_ERROR';
 if(diagnostic.bodyKind==='restriction-marker')return 'OFFICIAL_RESTRICTION_MARKER';
 if(diagnostic.phase==='list-parse')return (diagnostic.structure?.candidateContainers||0)>1?'LISTING_PARSE_AMBIGUOUS':'LISTING_PARSE_UNRECOGNIZED';
 return diagnostic.phase==='budget'?'LISTING_BUDGET_DEFERRED':diagnostic.phase==='request'?'LISTING_REQUEST_FAILED':'LISTING_RESPONSE_REJECTED';
}
function firstPageList(html:string,diagnose?:(structure:ChinaListingStructure)=>void,allowElements=false):string{
 const stack:{tag:string;start:number;offset:number}[]=[],groups:{body:string;offset:number;end:number}[]=[];
 for(const m of html.matchAll(/<\/?(ul|ol|table|dl)\b[^>]*>/gi)){const tag=m[1].toLowerCase();if(/^<\//.test(m[0])){const i=stack.map(x=>x.tag).lastIndexOf(tag);if(i<0)continue;const n=stack[i];stack.length=i;groups.push({body:html.slice(n.start,m.index),offset:n.offset,end:m.index+m[0].length});}else stack.push({tag,start:m.index+m[0].length,offset:m.index});}
 const visibleRows=rowBodies(html);const qualifying=groups.filter(g=>visibleRows.filter(r=>r.offset>g.offset&&r.end<g.end).some(r=>{const text=plain(r.body);return rowPublication(r.body,allowElements).hasDate&&(/航警|航通|航行警告|航行通告|IN[ -]FORCE|TOWING|MILITARY|CANCEL|\b(?:CN|CE|CS|TJ|LN|HB|SD|LYG|JS|SH|ZJ|FJ|GD|SZ|GX|HN)\s*\d+\s*\//i.test(text));}));
 const leaves=qualifying.filter(g=>!qualifying.some(c=>c.offset>g.offset&&c.end<g.end));
 if(diagnose){const linkedRows=visibleRows.filter(r=>/<a\b[^>]*\bhref\s*=/i.test(r.body));diagnose({parsedContainers:groups.length,visibleRows:visibleRows.length,datedLinkRows:linkedRows.filter(r=>dateToken.test(plain(r.body))).length,outsideLinkDatedRows:linkedRows.filter(r=>dateToken.test(plain(r.body.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi,'')))).length,insideLinkDateElementRows:linkedRows.filter(r=>[...r.body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].some(a=>dateElements(a[1]).length>0)).length,matchingContainers:qualifying.length,candidateContainers:leaves.length});}
 if(leaves.length!==1)throw Error('Regional first-page list container is missing or ambiguous');return leaves[0].body;
}
export function chinaFirstPageEntries(html:string,base:string,diagnose?:(structure:ChinaListingStructure)=>void):FirstPageEntry[]{
 const clean=html.replace(/<!--[\s\S]*?-->|<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,''),entries:FirstPageEntry[]=[];
 const allowElements=registeredDateElements(base);
 for(const [rowIndex,row] of rowBodies(firstPageList(clean,diagnose,allowElements)).entries()){
  const {publication}=rowPublication(row.body,allowElements);
  for(const a of row.body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){const href=attrs(a[0],'href');let label=a[2];if(allowElements)for(const element of dateElements(label))label=label.replace(element.markup,'');const title=plain(attrs(a[0],'title')||label).trim();if(!href||!title||/^(下一页|上一页|首页|末页|\d+|>|›|<|‹)$/.test(title))continue;
   let url:URL;try{url=new URL(href,base);}catch{continue;}url.hash='';
   if(!/^https?:$/.test(url.protocol)||url.href===new URL(base).href||/(?:^|\/)(?:index(?:_\d+)?|list|search|dataproxy)\.(?:j?s?html?|jsp)$/i.test(url.pathname)||/\/\s*$/.test(url.pathname))continue;
   const unsupported=!sameOrigin(url.href,base)?'Official first-page link has an unapproved origin; not fetched':/\.(?:pdf|docx?|xlsx?|zip|rar|odt)$/i.test(url.pathname)?'First-page attachment recorded; binary body extraction is not supported by this adapter':null;
   entries.push({url:url.href,title,position:entries.length,rowIndex,publication,status:unsupported?'unsupported-link':'pending',...(unsupported?{detail:unsupported}:{})});
  }
 }
 if(entries.length>CHINA_FIRST_PAGE_LIMITS.entries)throw Error('First-page entry resource limit; no silent truncation');return entries;
}
export function chinaTitleIdentity(title:string){
 const chinese=[...title.matchAll(new RegExp(warningNumber.source+'|(?:北部|东部|南部)航警\\s*\\d+\\s*\\/\\s*\\d{2,4}','g'))].map(m=>({id:canonicalWarningNumber(m[0])||m[0].replace(/\s/g,'').replace(/\/(\d{2})$/,'/20$1'),index:m.index,end:m.index+m[0].length}));
 const english=[...title.matchAll(/\b(CN|CE|CS|TJ|LN|HB|SD|LYG|JS|SH|ZJ|FJ|GD|SZ|GX|HN)\s*(\d+)\s*\/\s*(\d{2}|20\d{2})\b/g)].map(m=>({id:m[1]+Number(m[2])+'/'+(m[3].length===2?'20'+m[3]:m[3]),index:m.index,end:m.index+m[0].length}));
 const matches=[...chinese,...english].sort((a,b)=>a.index-b.index);
 const kind:'notice'|'cancellation'|'bulletin'=/现行.*(?:航行警告|航警)|有效.*(?:航行警告|航警)|(?:航行警告|航警).*(?:汇总|目录|统计)|IN[ -]FORCE|LIST OF.*WARNINGS/i.test(title)?'bulletin':/撤销|撤銷|注销|註銷|取消|废止|CANCEL/i.test(title)?'cancellation':'notice';
 const referenced=matches.filter(m=>{const prefix=title.slice(0,m.index).split(/[—–]|--/).at(-1)||'';return /(?:撤销|撤銷|注销|註銷|取消|废止|CANCEL(?:LED|LATION)?|REVOKE)[^，,。；;\n]{0,32}$/i.test(prefix);});
 const candidates=matches.filter(m=>!referenced.includes(m));let own:typeof matches[number]|undefined;
 if(candidates.length===1)own=candidates[0];else {const explicit=candidates.filter(m=>/[—–]|--/.test(title.slice(0,m.index))&&!title.slice(m.end).replace(/[）)】\]\s]/g,''));if(explicit.length===1)own=explicit[0];}
 if(kind==='bulletin'&&own&&!/^(?:CN|CE|CS|北部航警|东部航警|南部航警)/.test(own.id))own=undefined;
 return {ownId:own?.id||null,references:[...new Set(matches.filter(m=>m!==own).map(m=>m.id))],kind};
}
function bodyEvidence(html:string){
 const marked=html.match(/<!--\s*(?:正文开始|正文begin|正文内容开始|StartFragment|ZJEG_RSS.content.begin)\s*-->([\s\S]*?)<!--\s*(?:正文结束|正文end|正文内容结束|EndFragment|ZJEG_RSS.content.end)\s*-->/i);if(marked)return {text:plain(marked[1]),outside:html.replace(marked[0],'')};
 const start=/<(div|article)\b[^>]*(?:class|id)\s*=\s*["'](?:ch_p|zjy_main|article|article-content|article_content|TRS_Editor|TRS_UEDITOR|view|Custom_UnionStyle|content-body|art-content|zoom|zoomcon|detail-content)(?:\s[^"']*)?["'][^>]*>/gi;let m:RegExpExecArray|null;
 while((m=start.exec(html))){const tokens=new RegExp('</?'+m[1]+'\\b[^>]*>','gi');tokens.lastIndex=start.lastIndex;let depth=1,t;while((t=tokens.exec(html))){depth+=/^<\//.test(t[0])?-1:1;if(!depth){return {text:plain(html.slice(start.lastIndex,t.index).replace(/<div\b[^>]*class=["']foot_but["'][^>]*>[\s\S]*/i,'')),outside:html.slice(0,m.index)+html.slice(tokens.lastIndex)};}}}
 return {text:'',outside:html};
}
export async function parseChinaFirstPageArticle(html:string,entry:FirstPageEntry,source:NavSource,now:number):Promise<FirstPageNotice|null>{
 const body=bodyEvidence(html);if(!body.text.trim())return null;
 const title=meta(html,'ArticleTitle')[0]||plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||html.match(/<div\b[^>]*id=["']artibodyTitle["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||entry.title);
 const fromTitle=chinaTitleIdentity(title),fromRow=chinaTitleIdentity(entry.title),conflict=!!fromTitle.ownId&&!!fromRow.ownId&&fromTitle.ownId!==fromRow.ownId,ownId=conflict?null:fromTitle.ownId||fromRow.ownId;
 const metas=meta(html,'PubDate').map(x=>publicationEvidence(x,'meta-pubdate')).filter((x):x is PublicationEvidence=>!!x),visible=plain(body.outside).match(/(?:发布时间|发布日期|发文日期)\s*[：:]\s*(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/)?.[1];
 const shown=visible?publicationEvidence(visible,'visible-publication'):null,evidence=[...metas,...(shown?[shown]:[]),...(entry.publication?[entry.publication]:[])];
 let publication:PublicationEvidence|null=evidence.slice().sort((a,b)=>Number(b.epoch!==null)-Number(a.epoch!==null)||Number(b.precision==='second')-Number(a.precision==='second'))[0]||null;
 if(new Set(evidence.map(p=>p.date)).size>1||new Set(evidence.filter(p=>p.epoch!==null).map(p=>p.epoch)).size>1)publication=null;
 const issued=publication?.epoch??null,anchor=publication?.date||'',parsed=navWarningToNotice({title,text:body.text,published:anchor,url:entry.url,source:meta(html,'ContentSource')[0]||source.name});
 const entryKey=await hash(source.id+'\n'+entry.url),kind=fromTitle.kind==='notice'?fromRow.kind:fromTitle.kind;
 const unknownYear=!publication&&!/20\d{2}\s*年/.test(body.text),relative=/即日|自发布|自公布|自公告|发布之日起|FROM NOW|WITH IMMEDIATE EFFECT/i.test(body.text),noActivity=kind!=='notice';
 const periodAnchor=issued??(relative?null:publication?Date.parse(publication.date+'T00:00:00+08:00'):null),analysis=navPeriodAnalysis(body.text,periodAnchor),english=analysis.periods.length?null:englishUtcMaritimeAnalysis(body.text,periodAnchor),periods=analysis.periods.length?analysis.periods:english?.periods??[],dates=periods.length?{start:Math.min(...periods.map(p=>p.start)),end:Math.max(...periods.map(p=>p.end))}:{start:null,end:null},unresolvedRelative=relative&&issued===null;
 const periodUncertain=!periods.length||(analysis.periods.length?analysis.unparsedClauses.length>0:english?.timeUncertain!==false);
 return {...parsed,...dates,validityPeriods:periods,timeUncertain:periodUncertain,id:ownId||`通報番号未確認 ${source.id}-${entryKey.slice(0,10)}`,issued,sourceCountry:'CN',...(noActivity||unknownYear||unresolvedRelative?{start:null,end:null,validityPeriods:[],timeUncertain:true}:{}),...(noActivity?{shapes:[],purpose:'other'}:{}),warnings:[...new Set([...parsed.warnings,...navPeriodWarnings(body.text,periodAnchor),...(english?.warnings||[]),...(unresolvedRelative?['発表時刻がないため即日起の開始時刻は未確定です。']:[]),...(conflict?['一覧と本文の通報番号が一致しません。']:[]),...(publication?.precision==='day'?[`発表日 ${publication.date}（時刻の記載なし）`]:[]),...(!publication?['発表日時の明示資料を確認できません。']:[]),...(kind==='cancellation'?['取消通報です。対象番号とこの通報自身の番号を区別し、実効日時は原文で確認してください。']:[]),...(kind==='bulletin'?['現行・有効一覧の管理情報です。参照番号をこの通報の番号や活動区域として扱いません。']:[])])],chinaFirstPage:{schemaVersion:1,sourceId:source.id,entryKey,title,ownId,references:[...new Set([...fromTitle.references,...fromRow.references])],kind,publication,groupKey:ownId?source.id+'|'+ownId:null,originals:[{sourceUrl:entry.url,title,text:body.text,publication}],checkedAt:now}};
}
export function isChinaFirstPageNotice(n:Notice):n is FirstPageNotice{return !!(n as FirstPageNotice).chinaFirstPage?.entryKey;}
export function firstPageEventGroups(items:Notice[]){const groups=new Map<string,Notice[]>();for(const n of items){const key=isChinaFirstPageNotice(n)?n.chinaFirstPage.groupKey||n.chinaFirstPage.entryKey:n.sourceUrl||n.id;groups.set(key,[...(groups.get(key)||[]),n]);}return [...groups].map(([key,variants])=>{const periods=variants.filter(n=>n.validityPeriods?.length).map(n=>JSON.stringify(n.validityPeriods)),shapes=variants.filter(n=>n.shapes.length).map(n=>JSON.stringify(n.shapes));return {key,variants,conflicted:new Set(periods).size>1||new Set(shapes).size>1};});}

export function projectChinaFirstPageNotice(item:FirstPageNotice):FirstPageNotice{
 const administrative=item.chinaFirstPage.kind!=='notice';return {...item,...(administrative?{shapes:[],start:null,end:null,validityPeriods:[],timeUncertain:true}:{}),...(item.cancelled?{shapes:[]}:{} )};
}
type Validators={etag?:string;lastModified?:string};
export type ListingCache=Validators&{url:string;pageNumber:1|2;html:string;sha256:string;checkedAt:number;validatedAt:number;notModified:boolean;cacheRevision:number};
const safeValidator=(value:string|null)=>value&&value.length<=500&&!/[\r\n]/.test(value)?value:undefined;

function paginationEvidence(html:string){
 const stack:{tag:string;start:number;excluded:boolean;paging:boolean}[]=[],anchors:string[]=[],parts:string[]=[];let previousEnd=0;
 for(const m of html.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)){
  if(!stack.at(-1)?.excluded&&stack.some(x=>x.paging))parts.push(html.slice(previousEnd,m.index));previousEnd=m.index+m[0].length;
  const tag=m[1].toLowerCase();
  if(/^<\//.test(m[0])){const i=stack.map(x=>x.tag).lastIndexOf(tag);if(i<0)continue;const n=stack[i];if(tag==='a'&&!n.excluded&&stack.some(x=>x.paging))anchors.push(html.slice(n.start,previousEnd));stack.length=i;}
  else if(!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)&&!/\/\s*>$/.test(m[0])){
   const label=[attrs(m[0],'class'),attrs(m[0],'id'),attrs(m[0],'role'),attrs(m[0],'aria-label')].join(' '),excluded=!!stack.at(-1)?.excluded||/^(script|style|header|footer|aside)$/.test(tag)||/(?:^|[\s_-])(?:sidebar|related|recommend)(?:[\s_-]|$)/i.test(label)||/display\s*:\s*none|visibility\s*:\s*hidden|\shidden(?:\s|=|>)|aria-hidden\s*=\s*["']true/i.test(m[0]);
   stack.push({tag,start:m.index,excluded,paging:tag==='nav'||/(?:^|[\s_-])(?:page|pages|pager|paging|pagination|pagenav)(?:[\s_-]|$)/i.test(label)});
  }
 }
 return {anchors,text:plain(parts.join(' '))};
}
// Interpret only the registered CMS's literal pageParam template. No script
// execution, guessed suffixes, off-column targets or pagination from page two.
export function chinaCmsPagination(html:string,base:string):{url:string|null;singlePage:boolean}|null{
 if(!Object.values(chinaRegionalListingProfiles).some(p=>p.url===base))return null;
 const scripts=[...html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
 if(!/\blaypage\.render\(\s*pageParam\s*\)/.test(scripts))return null;
 const number=(key:string)=>{const values=[...scripts.matchAll(new RegExp('\\bpageParam\\.'+key+'\\s*=\\s*(\\d+)\\s*;','g'))].map(m=>Number(m[1]));return values.length===1&&Number.isSafeInteger(values[0])?values[0]:null;};
 const current=number('curr'),count=number('count'),limit=number('limit');
 if(current!==1||count===null||count<1||count>1000000||limit===null||limit<1||limit>500)return null;
 const routes=[...scripts.matchAll(/(?:window\.)?location\.href\s*=\s*['"](index_)['"]\s*\+\s*obj\.curr\s*\+\s*['"](\.(?:jhtml|html))['"]/g)];
 if(routes.length!==1)return null;
 return count<=limit?{url:null,singlePage:true}:{url:new URL(routes[0][1]+'2'+routes[0][2],base).href,singlePage:false};
}
export function advertisedSecondPage(html:string,base:string):{url:string|null;singlePage:boolean;problem?:string}{
 const clean=html.replace(/<!--[\s\S]*?-->|<(script|style|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const scripted=chinaCmsPagination(html,base),candidates:string[]=scripted?.url?[scripted.url]:[],evidence=paginationEvidence(clean);
 for(const tag of evidence.anchors){
  const title=plain(tag).replace(/\s/g,''),rel=attrs(tag,'rel');
  if(!/^(?:2|下一页|下页|下頁|下一頁|Next|Nextpage|›|»)$/i.test(title)&&!/(?:^|\s)next(?:\s|$)/i.test(rel))continue;
  if(/aria-disabled\s*=\s*["']true|class\s*=\s*["'][^"']*\bdisabled\b/i.test(tag))continue;
  let target:URL;try{target=new URL(attrs(tag,'href'),base);}catch{continue;}target.hash='';
  if(target.href===base||!/^https?:$/.test(target.protocol))continue;
  const origin=new URL(base),folder=origin.pathname.slice(0,origin.pathname.lastIndexOf('/')+1);
  if(!sameOrigin(target.href,base))return {url:null,singlePage:false,problem:'Advertised second page has an unapproved origin'};
  if(!target.pathname.startsWith(folder)||target.pathname.slice(folder.length).includes('/'))return {url:null,singlePage:false,problem:'Advertised second page leaves the registered column'};
  const suffix=target.pathname.match(/(?:index|page|list)[_-](\d+)\.(?:j?s?html?)$/i);if(suffix&&Number(suffix[1])>2)return {url:null,singlePage:false,problem:'Advertised next path contradicts page two'};
  if([...target.searchParams].some(([k,v])=>/^(?:page|pageNo|pageNum)$/i.test(k)&&/^\d+$/.test(v)&&Number(v)!==2))return {url:null,singlePage:false,problem:'Advertised next link contradicts page two'};
  candidates.push(target.href);
 }
 const unique=[...new Set(candidates)];if(unique.length>1)return {url:null,singlePage:false,problem:'Advertised second page is ambiguous'};
 if(unique.length===1)return scripted?.singlePage?{url:null,singlePage:false,problem:'Conflicting single-page and second-page advertisements'}:{url:unique[0],singlePage:false};
 const singlePage=scripted?.singlePage===true||/(?:共|总共|總共)\s*1\s*页|(?:共|总共|總共)\s*1\s*頁|\b(?:Page\s*)?1\s*(?:of|\/)\s*1\b/i.test(evidence.text);
 return {url:null,singlePage,...(!singlePage?{problem:'Second-page link or explicit one-page evidence not recognized'}:{})};
}
export function witnessedHistoryEligible(entry:FirstPageEntry,items:Notice[],now:number){
 const date=entry.publication?.date,cutoff=now-90*86400000;
 if(!date||Date.parse(date+'T23:59:59+08:00')>=cutoff)return true;
 if(chinaTitleIdentity(entry.title).kind!=='notice')return true;
 return items.filter(n=>n.sourceUrl===entry.url).some(n=>n.cancelled||n.end==null||n.end>now||n.timeUncertain||n.lifecycleUncertain||isChinaFirstPageNotice(n)&&(n.chinaFirstPage.references.length>0||!!n.chinaFirstPage.legacyCancellationKeys?.length));
}
export async function collectChinaFirstPage(source:NavSource,previous:SourceRecord,fetcher:typeof fetch=fetch,revision=8,checkpoint?:(record:FirstPageRecord)=>Promise<void>,budget?:NavRequestBudget):Promise<FirstPageRecord>{
 if(!CHINA_FIRST_PAGE_IDS.has(source.id)||new URL(source.url).origin!=='https://www.msa.gov.cn')throw Error('Unregistered official China regional source');
 const prior=previous as FirstPageRecord,started=Date.now(),deadline=started+CHINA_FIRST_PAGE_LIMITS.runMs;
 if(Math.max(prior.collectionRetryAfter||0,prior.firstPage?.retryAfter||0)>started)return prior;
 const bodyRequestLimit=budget?.bodyRequests??CHINA_FIRST_PAGE_LIMITS.bodyRequests;
 let requests=0,bytesTotal=0,stop=false,retryAfter=0,successful=0,validated=0,problem='',page:FirstPageState|undefined,pagesVerified=0,listingScopeComplete=false;
 const items=[...prior.items],listingCaches:ListingCache[]=[],validatedUrls=new Set<string>(),listingDiagnostics:ChinaListingDiagnostic[]=[];
 const read=async(url:string,cap:number,validators:Validators={},kind:'listing'|'body'='body',diagnostic?:ChinaListingDiagnostic,visited:string[]=[]):Promise<{html:string|null;notModified:boolean;etag?:string;lastModified?:string}>=>{
  if(!sameOrigin(url,source.url))throw Error('Unapproved source origin');
  if(requests>=2+bodyRequestLimit||Date.now()>deadline-1000)throw Error('Bounded regional request budget');if(budget){try{cap=await budget.reserve(kind,cap);}catch(error){stop=true;throw error;}}requests++;
  const headers:Record<string,string>={Accept:'text/html,application/xhtml+xml'};
  if(validators.etag)headers['If-None-Match']=validators.etag;else if(validators.lastModified)headers['If-Modified-Since']=validators.lastModified;
  const conditional=!!headers['If-None-Match']||!!headers['If-Modified-Since'];
  if(diagnostic)diagnostic.phase='request';
  // Slow official responses must not be confused with empty listings. These
  // per-request deadlines stay inside the unchanged 120 s / 48-request envelope.
  const response=await fetcher(url,{method:'GET',redirect:'manual',headers,signal:AbortSignal.timeout(Math.max(1,Math.min(kind==='listing'?20000:12000,deadline-Date.now())))});
  if(diagnostic){diagnostic.httpStatus=response.status;diagnostic.contentType=listingContentType(response.headers.get('content-type'));diagnostic.phase='response';}
  if([401,403,429,503].includes(response.status)){
   stop=true;const header=response.headers.get('retry-after'),delay=header&&/^\d+$/.test(header)?Number(header)*1000:header?Date.parse(header)-Date.now():0;
   retryAfter=Math.max(retryAfter,Date.now()+Math.max(Number.isFinite(delay)?delay:0,[401,403,429].includes(response.status)?6*3600000:3600000));
  }
  if(response.headers.has('location')||response.redirected||response.url&&response.url!==url||(response.status>=300&&response.status<400&&response.status!==304)){
   const location=response.headers.get('location');await response.body?.cancel().catch(()=>{});
   let target:URL|null=null;try{if(location)target=new URL(location,url);}catch{/* Invalid public redirect. */}
   // MSA legacy article links redirect to /<same article ID>.jhtml, sometimes
   // advertised as HTTP. Validate the identity and host before upgrading to HTTPS.
   const originalId=new URL(url).pathname.match(/^\/html\/cnmsa\/hxaq\/article\/20\d{2}\/([a-f\d]{16,64})\.html$/i)?.[1];
   const shortId=target?.pathname.match(/^\/([a-f\d]{16,64})\.jhtml$/i)?.[1];
   if(kind==='body'&&target&&originalId&&shortId===originalId&&target.hostname==='www.msa.gov.cn'&&!target.port&&['http:','https:'].includes(target.protocol)&&!target.username&&!target.password&&!target.search&&!target.hash)target.protocol='https:';
   const verifiedShort=!!(originalId&&shortId===originalId);
   if(kind==='body'&&[301,302,303,307,308].includes(response.status)&&target&&target.origin===new URL(source.url).origin&&!target.username&&!target.password&&!target.search&&!target.hash&&(/^\/html\/cnmsa\/hxaq\/article\/20\d{2}\/[a-f\d]{16,64}\.html$/i.test(target.pathname)||verifiedShort)&&visited.length<2&&target.href!==url&&!visited.includes(target.href))return read(target.href,cap,{},kind,undefined,[...visited,url]);
   if(kind==='listing')stop=true;
   throw Error(`Official redirect refused (HTTP ${response.status}; target ${target?target.origin+(/^\/[a-zA-Z0-9/_.-]{0,180}$/.test(target.pathname)?target.pathname:'/[path omitted]'):'missing'}; route ${target&&/^\/html\/cnmsa\/hxaq\/article\/20\d{2}\/[a-f\d]{16,64}\.html$/i.test(target.pathname)?'article':'non-article'}; query ${target?.search?'present':'absent'})`);
  }
  const tags={etag:safeValidator(response.headers.get('etag')),lastModified:safeValidator(response.headers.get('last-modified'))};
  if(response.status===304){await response.body?.cancel().catch(()=>{});if(!conditional)throw Error('Unsolicited 304 without matching saved validators');if(validators.etag&&tags.etag&&validators.etag!==tags.etag||!validators.etag&&validators.lastModified&&tags.lastModified&&validators.lastModified!==tags.lastModified)throw Error('304 validator does not match saved representation');return {html:null,notModified:true,...{etag:tags.etag||validators.etag,lastModified:tags.lastModified||validators.lastModified}};}
  if(!response.ok){if(response.status!==404)stop=true;await response.body?.cancel().catch(()=>{});throw Error(`Official HTTP ${response.status}`);}
  const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>cap)){await response.body?.cancel().catch(()=>{});throw Error('Official HTML byte limit');}if(!response.body)throw Error('Missing official body');
  if(diagnostic)diagnostic.phase='body';
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;bytesTotal+=value.length;if(diagnostic)diagnostic.bytesRead=size;if(size>cap||bytesTotal>CHINA_FIRST_PAGE_LIMITS.totalBytes)throw Error('Regional byte budget');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  if(diagnostic)diagnostic.phase='decode';
  const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(diagnostic){diagnostic.bodyKind=listingBodyKind(html);diagnostic.phase='access-check';}
  if(officialAccessRestriction(html)){stop=true;retryAfter=Date.now()+6*3600000;throw Error('Official access restriction');}
  return {html,notModified:false,...tags};
 };
 const listing=async(url:string,pageNumber:1|2)=>{
  // At most two fixed-shape diagnostics, overwritten each pass. No response
  // text, arbitrary header values, URLs, cookies, or historical accumulation.
  const diagnostic:ChinaListingDiagnostic={pageNumber,httpStatus:null,contentType:'missing',bytesRead:0,bodyKind:'unread',fromValidatedCache:false,phase:'budget',outcome:'pending',structure:null};listingDiagnostics.push(diagnostic);
  try{
   const cached=prior.firstPage?.listingCaches?.find(c=>c.url===url&&c.pageNumber===pageNumber&&c.sha256&&c.html);
   const validCache=cached&&cached.cacheRevision===revision&&await hash(cached.html)===cached.sha256?cached:undefined;
   const response=await read(url,CHINA_FIRST_PAGE_LIMITS.htmlBytes,validCache||{},'listing',diagnostic),html=response.html??validCache?.html;
   if(html===undefined)throw Error('304 listing has no matching saved content');
   diagnostic.fromValidatedCache=response.notModified;diagnostic.bodyKind=listingBodyKind(html);diagnostic.phase='list-parse';
   const entries=chinaFirstPageEntries(html,url,structure=>{diagnostic.structure=structure;}).map(e=>({...e,pageNumber}));if(!entries.length)throw Error('Regional rows not recognized; not verified zero');
   listingCaches.push({url,pageNumber,cacheRevision:revision,sha256:await hash(html),checkedAt:response.notModified?validCache!.checkedAt:started,validatedAt:started,...response,html});pagesVerified++;diagnostic.phase='complete';diagnostic.outcome='accepted';
   return {html,entries};
  }catch(error){diagnostic.outcome='failed';throw error;}
 };
 try{
  const first=await listing(source.url,1),entries:FirstPageEntry[]=[...first.entries];
  const advertised=advertisedSecondPage(first.html,source.url);listingScopeComplete=advertised.singlePage;
  if(advertised.problem)problem=advertised.problem;
  if(advertised.url&&!stop){try{const second=await listing(advertised.url,2);entries.push(...second.entries);listingScopeComplete=true;}catch(error){problem=error instanceof Error?error.message:'Second-page collection failed';}}
  const oldEntries=new Map([...(prior.firstPage?.priorEntries||[]),...(prior.firstPage?.entries||[])].map(e=>[e.url,e]));
  for(const e of entries){const old=oldEntries.get(e.url);if(e.status!=='unsupported-link'&&old&&old.title===e.title&&old.publication?.raw===e.publication?.raw){Object.assign(e,{status:old.status,bodyCheckedAt:old.bodyCheckedAt,attemptedAt:old.attemptedAt,ownId:old.ownId,groupKey:old.groupKey,etag:old.metadataConflict?undefined:old.etag,lastModified:old.metadataConflict?undefined:old.lastModified,bodySha256:old.metadataConflict?undefined:old.bodySha256,cacheRevision:old.metadataConflict?undefined:old.cacheRevision,bodyValidatedAt:old.bodyValidatedAt});}}
  for(const e of entries){const variants=entries.filter(v=>v.url===e.url);if(new Set(variants.map(v=>v.title+'\n'+v.publication?.raw)).size>1){e.metadataConflict=true;e.detail='The two listing representations disagree; all row evidence retained';delete e.etag;delete e.lastModified;}}
  const currentUrls=new Set(entries.map(e=>e.url)),archive=new Map([...(prior.firstPage?.priorEntries||[]),...(prior.firstPage?.entries||[])].filter(e=>!currentUrls.has(e.url)).map(e=>[e.url,e]));
  page={schemaVersion:1,url:source.url,checkedAt:started,sha256:listingCaches[0].sha256,entries,complete:false,cursor:0,priorEntries:[...archive.values()],listingCaches,listingScopeComplete,retryAfter:retryAfter||undefined};
  if(checkpoint)await checkpoint({...prior,firstPage:page,collectionRetryAfter:retryAfter||undefined,revision,listingUrl:source.url,continuation:undefined,status:{...previous.status,...source,state:'partial',checkedAt:started,detail:`先頭2ページ以内の${pagesVerified}ページを確認し全掲載行を保存。本文は分割確認中。前回原文を保持。`}});
  const witnessedPending=page.priorEntries.filter(e=>(e.status==='pending'||e.status==='failed')&&witnessedHistoryEligible(e,items,started));
  const unique=[...new Map([...entries,...witnessedPending].filter(e=>e.status!=='unsupported-link').map(e=>[e.url,e])).values()];
  const queue=[...unique].sort((a,b)=>Number(!currentUrls.has(a.url))-Number(!currentUrls.has(b.url))||Number(a.status==='read')-Number(b.status==='read')||Number(!!a.attemptedAt)-Number(!!b.attemptedAt)||(a.attemptedAt||0)-(b.attemptedAt||0)||Number(!currentUrls.has(a.url))-Number(!currentUrls.has(b.url))||(a.pageNumber||1)-(b.pageNumber||1)||a.position-b.position).slice(0,bodyRequestLimit);
  for(let i=0;i<queue.length&&!stop&&Date.now()<deadline-1000;i+=CHINA_FIRST_PAGE_LIMITS.concurrency){
   const batch=queue.slice(i,i+CHINA_FIRST_PAGE_LIMITS.concurrency);
   const results=await Promise.all(batch.map(async entry=>{
    try{
     const saved=items.find(n=>n.sourceUrl===entry.url),reusable=saved&&entry.cacheRevision===revision&&entry.bodySha256===await hash(JSON.stringify(saved)),response=await read(entry.url,CHINA_FIRST_PAGE_LIMITS.bodyBytes,reusable?entry:{});
     if(response.notModified){if(!saved||!reusable)throw Error('304 body has no matching saved original');return {entry,notice:null,response,error:null};}
     const notice=await parseChinaFirstPageArticle(response.html!,entry.metadataConflict?{...entry,title:'一覧情報不一致',publication:null}:entry,source,Date.now());if(!notice)throw Error('Article body not recognized; prior original retained');
     return {entry,notice,response,error:null};
    }catch(error){return {entry,notice:null,response:null,error:error instanceof MaritimeBudgetDeferred?error.message:error instanceof Error?error.message:'Body fetch failed'};}
   }));
   for(const {entry,notice,response,error} of results){
    const affected=[...entries,...page.priorEntries].filter(e=>e.url===entry.url);for(const e of affected)e.attemptedAt=Date.now();
    if(error||!response){for(const e of affected){e.status='failed';e.detail=error||'Body unavailable';}problem||=error||'Body unavailable';continue;}
    if(response.notModified){validated++;validatedUrls.add(entry.url);for(const e of affected){e.status='read';e.detail=undefined;e.bodyValidatedAt=Date.now();e.etag=response.etag;e.lastModified=response.lastModified;}continue;}
    if(!notice)throw Error('Missing parsed body');
    if(affected.some(e=>e.metadataConflict)){notice.chinaFirstPage.ownId=null;notice.chinaFirstPage.groupKey=null;notice.chinaFirstPage.publication=null;notice.issued=null;notice.start=null;notice.end=null;notice.validityPeriods=[];notice.timeUncertain=true;notice.id=`通報番号未確認 ${source.id}-${notice.chinaFirstPage.entryKey.slice(0,10)}`;notice.warnings.push('2ページ内の同一URL掲載情報が一致しません。両方の一覧資料と本文を確認してください。');}
    const priorNotices=items.filter(n=>n.sourceUrl===entry.url);notice.cancelled=notice.cancelled||priorNotices.some(n=>n.cancelled);notice.chinaFirstPage.legacyCancellationKeys=[...new Set(priorNotices.flatMap(n=>isChinaFirstPageNotice(n)?n.chinaFirstPage.legacyCancellationKeys||[]:legacyCancellationKeys(n)))];
    const originals:Original[]=[...notice.chinaFirstPage.originals,...priorNotices.flatMap(n=>isChinaFirstPageNotice(n)?n.chinaFirstPage.originals:[{sourceUrl:entry.url,title:n.id,text:n.text,publication:null}])];notice.chinaFirstPage.originals=[...new Map(originals.map(o=>[o.sourceUrl+'\n'+o.title+'\n'+o.text+'\n'+o.publication?.raw,o])).values()];
    const prospective=[...items.filter(n=>n.sourceUrl!==entry.url),projectChinaFirstPageNotice(notice)];
    if(new TextEncoder().encode(JSON.stringify({...prior,items:prospective,firstPage:page})).length>CHINA_FIRST_PAGE_LIMITS.sourceBytes){for(const e of affected){e.status='failed';e.detail='Source storage budget; prior originals retained';}problem||='Source storage budget';continue;}
    items.splice(0,items.length,...prospective);successful++;validatedUrls.add(entry.url);
    for(const e of affected){e.status='read';e.detail=e.metadataConflict?'Listing metadata conflict; originals retained':undefined;e.bodyCheckedAt=Date.now();e.bodyValidatedAt=Date.now();e.bodySha256=await hash(JSON.stringify(prospective.at(-1)));e.cacheRevision=revision;e.ownId=notice.chinaFirstPage.ownId;e.groupKey=notice.chinaFirstPage.groupKey;e.etag=response.etag;e.lastModified=response.lastModified;}
   }
  }
  page.complete=listingScopeComplete&&entries.every(e=>e.status==='read'&&validatedUrls.has(e.url));page.retryAfter=retryAfter||undefined;
 }catch(error){problem=error instanceof Error?error.message:'Regional collection failed';page=prior.firstPage?{...prior.firstPage,retryAfter:retryAfter||prior.firstPage.retryAfter}:undefined;pagesVerified=0;listingScopeComplete=false;}
 const verifiedPage=!!page&&page.checkedAt===started,entries=verifiedPage?page!.entries:[],remaining=entries.filter(e=>e.status!=='read');
 const allWitnessedRemaining=(page?.priorEntries||[]).filter(e=>e.status!=='read'),witnessedRemaining=allWitnessedRemaining.filter(e=>witnessedHistoryEligible(e,items,started)),deferredHistoryRows=allWitnessedRemaining.length-witnessedRemaining.length;
 const metadataConflicts=entries.filter(e=>e.metadataConflict).length,currentUnvalidated=entries.filter(e=>!validatedUrls.has(e.url)).length;
 const state:SourceStatus['state']=!verifiedPage?'error':problem||!listingScopeComplete||remaining.length||witnessedRemaining.length||metadataConflicts||entries.some(e=>!validatedUrls.has(e.url))?'partial':'ok';
 const firstPage=page?{...page,retryAfter:retryAfter||page.retryAfter}:undefined;
 const listedRows=new Set(entries.map(e=>(e.pageNumber||1)+':'+(e.rowIndex??e.position))).size;
 const detail=verifiedPage?`当該地域の先頭2ページ以内で${pagesVerified}ページ・${listedRows}掲載行・${new Set(entries.map(e=>e.url)).size}原文リンクを確認。今回本文保存${successful}件・変更なし確認${validated}件・現在ページ本文の今回未確認${currentUnvalidated}件（保存未完了${remaining.length}件）・過去の掲載本文待ち${witnessedRemaining.length}件。3ページ目以降は取得しません。過去分の既定確認範囲90日、範囲外待機${deferredHistoryRows}件。有効・取消関係と保存済み原文は保持。${problem?problem+'。':''}全国網羅は未確認。`:`先頭ページを確認できません（0件ではありません）。${problem}。保存済み原文と取得日時を保持。`;
 const currentValidationTimes=entries.map(e=>e.bodyValidatedAt||e.bodyCheckedAt||0),sourceValidatedAt=listingScopeComplete&&entries.length&&!remaining.length&&!metadataConflicts&&currentValidationTimes.every(Boolean)?Math.min(...currentValidationTimes,...listingCaches.map(c=>c.validatedAt)):null;
 const failedListing=listingDiagnostics.find(diagnostic=>diagnostic.outcome==='failed');
 // One bounded, allowlisted event per failed listing attempt. No provider text
 // or arbitrary headers; native Worker logs can inspect this without full rows.
 if(failedListing){try{console.warn(JSON.stringify({event:'china-regional-listing-diagnostic',schemaVersion:1,sourceId:source.id,reason:listingFailureReason(failedListing),pages:listingDiagnostics}));}catch{/* Observability must never change retained data or collection outcome. */}}
 const status:SourceStatus&{collection:Record<string,unknown>}={...source,state,checkedAt:started,fetchedAt:successful?started:previous.status.fetchedAt,validatedAt:sourceValidatedAt,count:items.length,pages:pagesVerified,detail,collection:{policy:'registered-regional-first-two-pages',listingDiagnostics,pageLimit:2,historyDays:90,metadataConflicts,firstPageVerified:verifiedPage,listingScopeComplete,listedRows,listedEntries:entries.length,distinctLinks:new Set(entries.map(e=>e.url)).size,bodiesSavedThisPass:successful,bodiesValidatedUnchanged:validated,currentBodiesValidatedThisPass:[...new Set(entries.map(e=>e.url))].filter(url=>validatedUrls.has(url)).length,allCurrentBodiesValidatedThisPass:entries.length>0&&entries.every(e=>validatedUrls.has(e.url)),unresolved:remaining.length,currentBodiesUnverifiedThisPass:currentUnvalidated,witnessedBacklogUnresolved:witnessedRemaining.length,deferredHistoryRows,currentPageComplete:verifiedPage&&listingScopeComplete&&remaining.length===0&&currentUnvalidated===0&&metadataConflicts===0,witnessedBacklogComplete:witnessedRemaining.length===0,pagination:true,pagesRead:pagesVerified,entries:entries.map(({url,title,position,rowIndex,pageNumber,publication,status,detail})=>({url,title,position,rowIndex,pageNumber,publication,status,detail}))}};
 return {...prior,items,revision,collectionRetryAfter:retryAfter||undefined,firstPage,listingUrl:source.url,continuation:undefined,pendingArticles:[...(verifiedPage?remaining:(page?.entries||[]).filter(e=>e.status!=='read')),...witnessedRemaining].filter(e=>e.status==='pending').map(e=>e.url),retryArticles:[...(verifiedPage?remaining:(page?.entries||[]).filter(e=>e.status!=='read')),...witnessedRemaining].filter(e=>e.status==='failed').map(e=>e.url),deferredHistory:prior.deferredHistory||{continuation:prior.continuation,pendingArticles:prior.pendingArticles,retryArticles:prior.retryArticles},status};
}
export const CHINA_FIRST_PAGE_PREFIX='cn-first-page:v1:source:';
function validFirstPageRecord(value:unknown,id:string):value is FirstPageRecord{
 if(!value||typeof value!=='object')return false;const r=value as FirstPageRecord;
 const publication=(p:unknown)=>p===null||!!p&&typeof p==='object'&&typeof (p as PublicationEvidence).date==='string'&&typeof (p as PublicationEvidence).raw==='string'&&['day','minute','second'].includes((p as PublicationEvidence).precision)&&((p as PublicationEvidence).epoch===null||Number.isFinite((p as PublicationEvidence).epoch));
 const entry=(e:FirstPageEntry)=>!!e&&typeof e.url==='string'&&typeof e.title==='string'&&Number.isInteger(e.position)&&['pending','read','failed','unsupported-link'].includes(e.status)&&publication(e.publication)&&(e.etag===undefined||safeValidator(e.etag)===e.etag)&&(e.lastModified===undefined||safeValidator(e.lastModified)===e.lastModified);
 if(r.status?.id!==id||!Array.isArray(r.items))return false;
 for(const n of r.items){if(!n||typeof n.id!=='string'||typeof n.text!=='string'||!Array.isArray(n.warnings)||!n.warnings.every(w=>typeof w==='string')||!Array.isArray(n.shapes)||!n.shapes.every(s=>s&&['point','polygon','line','circle'].includes(s.kind)&&Array.isArray(s.points)&&s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))))return false;
 if('chinaFirstPage' in n){const c=(n as FirstPageNotice).chinaFirstPage;if(!c||c.schemaVersion!==1||c.sourceId!==id||typeof c.entryKey!=='string'||!Array.isArray(c.references)||!c.references.every(r=>typeof r==='string')||!['notice','cancellation','bulletin'].includes(c.kind)||!publication(c.publication)||!Array.isArray(c.originals)||!c.originals.every(o=>o&&typeof o.text==='string'&&typeof o.title==='string'&&typeof o.sourceUrl==='string')||c.legacyCancellationKeys&&(!Array.isArray(c.legacyCancellationKeys)||!c.legacyCancellationKeys.every(k=>typeof k==='string')))return false;}}
 if(r.firstPage?.listingCaches&&(!Array.isArray(r.firstPage.listingCaches)||!r.firstPage.listingCaches.every(c=>c&&typeof c.url==='string'&&typeof c.html==='string'&&typeof c.sha256==='string'&&[1,2].includes(c.pageNumber)&&Number.isInteger(c.cacheRevision)&&(c.etag===undefined||safeValidator(c.etag)===c.etag)&&(c.lastModified===undefined||safeValidator(c.lastModified)===c.lastModified))))return false;
 if(r.firstPage&&(!Array.isArray(r.firstPage.entries)||!r.firstPage.entries.every(entry)||!Array.isArray(r.firstPage.priorEntries)||!r.firstPage.priorEntries.every(entry)))return false;
 return true;
}
export async function readChinaFirstPageSources(db:D1Database,activeIds:readonly string[]=[...CHINA_FIRST_PAGE_IDS]){
 const ids=[...new Set(activeIds.filter(id=>CHINA_FIRST_PAGE_IDS.has(id)))],keys=ids.map(id=>CHINA_FIRST_PAGE_PREFIX+id);if(!keys.length)return {records:[] as FirstPageRecord[],errors:[] as string[]};
 let rows:{results:{id:string;data:string}[]};try{rows=await db.prepare(`SELECT id,data FROM reference_cache WHERE id IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{id:string;data:string}>();}catch{return {records:[] as FirstPageRecord[],errors:ids};}
 const records:FirstPageRecord[]=[],errors:string[]=[];for(const row of rows.results){const id=row.id.slice(CHINA_FIRST_PAGE_PREFIX.length);if(!keys.includes(row.id))continue;try{if(new TextEncoder().encode(row.data).length>CHINA_FIRST_PAGE_LIMITS.sourceBytes)throw Error('China first-page shadow row too large');const record=JSON.parse(row.data) as FirstPageRecord;if(!validFirstPageRecord(record,id))throw Error('China first-page shadow owner mismatch');records.push(record);}catch{errors.push(id);}}return {records,errors};
}
export async function writeChinaFirstPageSource(db:D1Database,record:FirstPageRecord,lease:{id:string;startedAt:number}){
 const id=record.status.id,text=JSON.stringify(record);if(!CHINA_FIRST_PAGE_IDS.has(id)||!validFirstPageRecord(record,id)||lease.id!=='nav:'+id||new TextEncoder().encode(text).length>CHINA_FIRST_PAGE_LIMITS.sourceBytes)throw Error('China first-page source owner/size check failed');
 const result=await db.prepare('INSERT INTO reference_cache(id,data,checked_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM nav_refresh WHERE id=? AND started_at=? AND lease_until>?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at').bind(CHINA_FIRST_PAGE_PREFIX+id,text,Date.now(),lease.id,lease.startedAt,Date.now()).run();if(!result.meta.changes)throw Error('China first-page lease expired; originals retained');
}
