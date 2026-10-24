import {advertisedSecondPage,chinaCmsPagination,type FirstPageRecord} from './nav-china-first-page';
import type {Notice} from './notam';

const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');

// Verify the current listing generation, not a frozen list or aggregate count.
// The public summary contains counts/times only; row evidence is owner-only.
export async function auditChinaLatestPages(record:FirstPageRecord,publicItems:Notice[],now=Date.now()){
 const page=record.firstPage,entries=page?.entries||[],unique=[...new Map(entries.map(e=>[e.url,e])).values()];
 const caches=[];
 for(const cache of page?.listingCaches||[])if(cache.sha256===await digest(cache.html)&&cache.validatedAt>=(page?.checkedAt||Infinity))caches.push(cache);
 const pageNumbers=new Set(caches.map(c=>c.pageNumber));
 const listingCurrent=!!page&&page.checkedAt===record.status.checkedAt&&pageNumbers.has(1)&&caches.some(c=>c.pageNumber===1&&c.sha256===page.sha256);
 const scopeVerified=listingCurrent&&page?.listingScopeComplete===true&&(pageNumbers.has(2)||caches.some(c=>c.pageNumber===1&&advertisedSecondPage(c.html,c.url).singlePage));
 const listingFresh=listingCurrent&&now>=page!.checkedAt&&now-page!.checkedAt<=2*3600000;
 const savedByUrl=new Map(record.items.map(n=>[n.sourceUrl,n]));
 const publicByUrl=new Map<string,Notice[]>();
 for(const item of publicItems)if(item.sourceUrl)publicByUrl.set(item.sourceUrl,[...(publicByUrl.get(item.sourceUrl)||[]),item]);
 const rows:{url:string;pageNumber:number;state:string;hasSavedBody:boolean;savedBodyVerified:boolean;bodyVerifiedAt:number|null;verifiedThisUpdate:boolean;publicBodyMatches:boolean;metadataConflict:boolean}[]=[];
 for(const entry of unique){
  const saved=savedByUrl.get(entry.url),hasBody=!!saved?.text.trim();
  const savedVerified=hasBody&&entry.bodySha256===await digest(JSON.stringify(saved));
  const verifiedAt=entry.bodyValidatedAt||entry.bodyCheckedAt||null;
  const verifiedThisUpdate=entry.status==='read'&&savedVerified&&!entry.metadataConflict&&!!verifiedAt&&verifiedAt>=(page?.checkedAt||Infinity);
  const publicBodyMatches=hasBody&&(publicByUrl.get(entry.url)||[]).some(n=>n.text===saved!.text);
  rows.push({url:entry.url,pageNumber:entry.pageNumber||1,state:entry.status,hasSavedBody:hasBody,savedBodyVerified:savedVerified,bodyVerifiedAt:verifiedAt,verifiedThisUpdate,publicBodyMatches,metadataConflict:!!entry.metadataConflict});
 }
 const count=(key:'hasSavedBody'|'savedBodyVerified'|'verifiedThisUpdate'|'publicBodyMatches')=>rows.filter(r=>r[key]).length;
 const complete=!!rows.length&&listingFresh&&scopeVerified&&rows.every(r=>r.verifiedThisUpdate&&r.publicBodyMatches);
 const summary={schemaVersion:1,scope:'latest-advertised-two-pages',listingCheckedAt:page?.checkedAt||null,listingCurrent,listingFresh,scopeVerified,pagesVerified:pageNumbers.size,listedRows:entries.length,distinctLinks:rows.length,savedBodies:count('hasSavedBody'),verifiedSavedBodies:count('savedBodyVerified'),bodiesVerifiedThisUpdate:count('verifiedThisUpdate'),publicBodiesMatched:count('publicBodyMatches'),missingBodies:rows.filter(r=>!r.hasSavedBody).length,failedBodies:rows.filter(r=>r.state==='failed').length,unsupportedBodies:rows.filter(r=>r.state==='unsupported-link').length,complete};
 return {summary,rows};
}

// Owner-only diagnostics from saved official public HTML. No article text,
// cookies, arbitrary headers or external requests are returned.
export function inspectChinaPagination(record:FirstPageRecord){
 const attr=(tag:string,key:string)=>tag.match(new RegExp('\\b'+key+'\\s*=\\s*["\']([^"\']*)["\']','i'))?.[1]||'';
 const text=(s:string)=>s.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
 return (record.firstPage?.listingCaches||[]).map(cache=>({pageNumber:cache.pageNumber,cms:chinaCmsPagination(cache.html,cache.url),
  containers:[...cache.html.matchAll(/<(?:div|nav|span|ul)\b[^>]*>/gi)].map(m=>({tag:m[0].match(/^<(\w+)/)?.[1],class:attr(m[0],'class'),id:attr(m[0],'id')})).filter(x=>/page|paging|fenye/i.test(x.class+' '+x.id)).slice(0,12),
  links:[...cache.html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].filter(m=>/^(?:2|下一页|下页|下頁|下一頁|Next|Nextpage|›|»)$/.test(text(m[0]))).slice(0,12).map(m=>{
   const href=attr(m[0],'href'),label=text(m[0]);
   if(/^javascript:/i.test(href)){const call=href.match(/^javascript:\s*(\w+)\(\s*(\d+)\s*\)\s*;?$/i);return {label,kind:'script',function:call?.[1]||null,page:call?Number(call[2]):null};}
   try{const target=new URL(href,cache.url);return {label,kind:'link',sameOrigin:target.origin===new URL(cache.url).origin,path:target.pathname,pageParams:[...target.searchParams].filter(([k,v])=>/^(page|pageNo|pageNum)$/i.test(k)&&/^\d+$/.test(v))};}catch{return {label,kind:'invalid'};}
  }),
  scriptNames:[...new Set([...cache.html.matchAll(/\b([A-Za-z_$][\w$]*(?:Page|page|Pagination|pagination)[\w$]*)\s*\(/g)].map(m=>m[1]))].slice(0,12),
 }));
}
