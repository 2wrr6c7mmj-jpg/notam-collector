// Existing Taiwan source: current official listing + RSS discovery, complete attachment evidence, and verified ODT semantics.
import type { Notice } from './notam';
import type { NavSource } from './nav-sources';
import type { SourceRecord } from './nav-store';
import { enrichTwOdtNotice,parseTwOdtGeometry,parseTwOdtPartialGeometry,parseTwOdtTextPartialGeometry,twOdtContent } from './nav-tw-odt';
import { twDay, twGet, twPriorBackoff, twStopEvidence, type TwBackoff, twEvidenceOf, twPublicNotice, twBoundBudget, twWithinHistory, twSha256, twPlain, twText, twOfficialUrl, twUnknown, twUncertainNotice, twExplicitSelfCancellation, type TwNotice, type TwReceipt, type TwRequestBudget } from './nav-tw-evidence';
import { twElement } from './nav-tw-motc';
import { extractTwDocument } from './nav-tw-documents';
import reviewedBundles from './nav-tw-reviewed-bundles.json';

export const twFisheriesSource: NavSource = {
  id: 'tw-fisheries', name: '台湾漁業署 射擊通報', region: '台湾周辺（公開射撃通報）',
  country: 'TW', parser: 'tw-fisheries',
  url: 'https://www.fa.gov.tw/wm_DATA.php?data=Shooting_bulletin',
};
const UNPARSED = '未解析：射撃通報RSSの掲載情報のみ。PDF・ODT原文の区域・実施時間は未解析です。';
function decode(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
      const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : +n;
      return cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\uFFFD';
    }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function plain(s: string): string {
  return decode(s.replace(/<\s*(?:br\s*\/?|\/p|\/div)\s*>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
}
export function twAttachmentLinks(context: string): string[] {
  const decoded = decode(context), links: string[] = [];
  for (const m of decoded.matchAll(/(?:href\s*=\s*["']([^"']+)["']|(https?:\/\/[^\s<>"']+))/gi)) {
    try {
      const u = new URL(decode(m[1] || m[2]), 'https://www.fa.gov.tw/');
      if (u.protocol === 'https:' && /(?:\.(?:pdf|odt)(?:$|[?#])|\/redirect_file\.php(?:$|\?))/i.test(u.href)) links.push(u.href);
    } catch { /* malformed attachment URL is not fetched */ }
  }
  return [...new Set(links)];
}
export function parseTwFisheriesRss(xml: string): Notice[] {
  if (xml.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/^\s*(?:<\?xml[^>]*>\s*)?<rss\b[^>]*>[\s\S]*<channel\b[^>]*>[\s\S]*<\/channel>\s*<\/rss>\s*$/.test(xml)) throw new Error('台湾RSSの形式を確認できません');
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)];
  if (!blocks.length) throw new Error('台湾RSSが空です。警告0件とは確認できません');
  const seen = new Set<string>();
  return blocks.map((m): TwNotice => {
    const value = (key: string) => decode(m[1].match(new RegExp(`<${key}\\b[^>]*>([\\s\\S]*?)</${key}>`))?.[1] || '').trim();
    const title = value('title'), pubDate = value('pubDate'), context = value('context'), url = value('link'), deleted = value('isDelete');
    let u: URL; try { u = new URL(url); } catch { throw new Error('台湾RSS記事URLが不正です'); }
    const id = u.searchParams.get('id'), issued = Date.parse(pubDate);
    if (!title || !Number.isFinite(issued) || !/^\d+$/.test(id || '') || u.protocol !== 'https:' || u.hostname !== 'www.fa.gov.tw' || u.pathname !== '/view.php' || u.searchParams.get('theme') !== 'Shooting_bulletin' || !/^(?:true|false)$/.test(deleted)) throw new Error('台湾RSS必須項目が不正です');
    if (seen.has(id!)) throw new Error('台湾RSS記事IDが重複しています'); seen.add(id!);
    const attachmentLinks = twAttachmentLinks(context);
    return {
      id: `TW-FA-${id}`, location: title, text: [title, `RSS pubDate: ${pubDate}`, plain(context), ...(attachmentLinks.length ? ['原文添付リンク:', ...attachmentLinks] : [])].filter(Boolean).join('\n'),
      issued: null, start: null, end: null, permanent: false, purpose: 'firing', shapes: [], validityPeriods: [], timeUncertain: true,
      warnings: [UNPARSED, '発表日を活動期間として扱っていません。原文の更新・取消・再掲を確認してください。', ...(deleted === 'true' ? ['掲載削除フラグあり。活動取消とは断定できません。'] : [])],
      sourceUrl: url, sourceName: twFisheriesSource.name, sourceCountry: 'TW',
      taiwan: {version:2,publisher:'FA',role:'supplement',publication:{value:new Date(issued+8*3600000).toISOString().slice(0,10),precision:'day',evidence:`RSS pubDate: ${pubDate}`},documents:[],attachments:attachmentLinks.map(url=>({url,state:'pending'})),bodyComplete:false,semanticComplete:false,rights:{status:'unverified',url:'https://www.fa.gov.tw/information.php',detail:'RSSは非商用・出典表示条件。添付資料の個別権利を別途確認。'},unresolved:[UNPARSED]},
    };
  });
}
export type TwAttachment={url:string;format:'odt'|'pdf'|'other'};
export type MaritimeAttachment = {
  status: 'unattempted'|'unsupported'|'fetch-error'|'fulltext-retained';
  format?: 'odt'|'pdf'|'other'; sourceUrl?: string; checkedAt?: number; bodyFetchedAt?: number; detail?: string; textTruncated?: boolean;
};
export const TW_ODT_PARSER_VERSION=4;
export const TW_MAX_ARTICLES=2;
export const TW_FISHERIES_LIST='https://www.fa.gov.tw/list.php?theme=Shooting_bulletin&subtheme=';
export type TwCacheEntry = {reason?:'parsed'|'pdf-only'|'no-odt'|'multiple-odt'|'odt-unparsed'|'read-error';attachments?:Array<{url:string;format:'odt'|'pdf'|'other'}>;document?:{url:string;fetchedAt:number;text:string;truncated:boolean};parserVersion?:number;fingerprint:string;checkedAt:number;outcome:'parsed'|'unsupported'|'error';detail:string;enriched?:TwNotice;lastSuccess?:TwNotice};
export type TwSourceRecord=SourceRecord & {taiwanBackoff?:TwBackoff;twOdt?:{version:2;cursor:number;cache:Record<string,TwCacheEntry>;listingReceipt?:TwReceipt;rssReceipt?:TwReceipt}};
export function twOdtLinks(html:string,base:string):string[]{return twAllDocuments(html,base).filter(a=>a.format==='odt').map(a=>a.url);}
export function twAllDocuments(html:string,base:string):Array<{url:string;format:'odt'|'pdf'|'unknown'}>{
  const group=twElement(html,'div',/\bclass=["'][^"']*\bdownload-group\b/),links:Array<{url:string;format:'odt'|'pdf'|'unknown'}>=[];
  for(const m of group.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    const href=m[1].match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];if(!href)continue;
    const url=twOfficialUrl(href,['www.fa.gov.tw'],base),label=plain(m[1]+' '+m[2]);
    if(!links.some(a=>a.url===url))links.push({url,format:/\bODT\b|\.odt/i.test(label)?'odt':/\bPDF\b|\.pdf/i.test(label)?'pdf':'unknown'});
  }
  if(!links.length)throw new Error('添付領域に文書リンクを確認できません');
  return links;
}
export function parseTwFisheriesList(html:string):TwNotice[]{
  const table=twElement(html,'table',/\bclass=["'][^"']*\brwd-table\b/),items:TwNotice[]=[];
  for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    if(/<th\b/i.test(row[1]))continue;
    const a=row[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i),date=row[1].match(/<td\b[^>]*data-th=["']發布日期["'][^>]*>([\s\S]*?)<\/td>/i);
    if(!a||!date)throw new Error('台湾漁業署一覧の未対応行');
    const raw=plain(date[1]),dm=raw.match(/^(1\d{2})-(\d{2})-(\d{2})$/),day=dm?twDay(`${+dm[1]+1911}/${dm[2]}/${dm[3]}`):undefined;
    const url=twOfficialUrl(a[1],['www.fa.gov.tw'],TW_FISHERIES_LIST),u=new URL(url),id=u.searchParams.get('id'),title=plain(a[2]);
    if(!day||!title||!/^\d+$/.test(id||'')||u.pathname!=='/view.php'||u.searchParams.get('theme')!=='Shooting_bulletin')throw new Error('台湾漁業署一覧の日時・URL形式');
    if(items.some(n=>n.id===`TW-FA-${id}`))throw new Error('台湾漁業署一覧のID重複');
    items.push({id:`TW-FA-${id}`,location:title,text:`${title}\n掲載日: ${day}`,issued:null,start:null,end:null,permanent:false,purpose:'firing',shapes:[],validityPeriods:[],timeUncertain:true,sourceUrl:url,sourceName:twFisheriesSource.name,sourceCountry:'TW',warnings:[UNPARSED],taiwan:{version:2,publisher:'FA',role:'supplement',publication:{value:day,precision:'day',evidence:`發布日期: ${raw}（台湾政府民国紀年）`},documents:[],attachments:[],bodyComplete:false,semanticComplete:false,rights:{status:'unverified',url:'https://www.fa.gov.tw/information.php',detail:'本文・添付資料の再配布条件は個別確認が必要。'},unresolved:[UNPARSED]}});
  }
  if(!items.length)throw new Error('台湾漁業署一覧が空です。警告0件とは確認できません');return items;
}
export async function collectTwFisheriesSource(source:NavSource,previous:SourceRecord,fetcher:typeof fetch=fetch,budget?:TwRequestBudget):Promise<SourceRecord>{
  const backoff=twPriorBackoff(previous as SourceRecord&{taiwanBackoff?:TwBackoff});if(backoff)return {...previous,status:{...previous.status,detail:`発表元の再試行待機中（${new Date(backoff.until).toISOString()}まで）。保存データを保持。`}};
  const requestBudget=twBoundBudget(budget,6);
  const checkedAt=Date.now(),deadline=checkedAt+25_000,old=previous as TwSourceRecord;let pages=0,failed=0,attempted=0;
  const get=async(url:string,cap=256*1024,limit=deadline,kind:'listing'|'body'='body')=>{const r=await twGet(url,['www.fa.gov.tw'],fetcher,Math.min(deadline,limit),cap,requestBudget,kind);pages++;return r;};
  try{
    let rss:TwNotice[]=[],listing:TwNotice[]=[],rssReceipt:TwReceipt|undefined,listingReceipt:TwReceipt|undefined;
    const discoveryProblems:string[]=[];
    try{const r=await get(TW_FISHERIES_LIST,320*1024,deadline,'listing');listing=parseTwFisheriesList(twText(r.bytes));listingReceipt={...r.receipt,extraction:'complete'};}catch(e){failed++;discoveryProblems.push(`現行一覧: ${e instanceof Error?e.message:'取得失敗'}`);if(twStopEvidence(e,requestBudget))throw e;}
    try{const r=await get(source.url,512*1024,deadline,'listing');rss=parseTwFisheriesRss(twText(r.bytes)) as TwNotice[];rssReceipt={...r.receipt,extraction:'complete'};}catch(e){failed++;discoveryProblems.push(`RSS: ${e instanceof Error?e.message:'取得失敗'}`);if(twStopEvidence(e,requestBudget))throw e;}
    if(!rss.length&&!listing.length)throw new Error(discoveryProblems.join(' / '));
    const byId=new Map(rss.map(n=>[n.id,n]));for(const n of listing)byId.set(n.id,n);
    // A fresh listing contains no lifecycle proof that can undo a witnessed
    // cancellation or exact supersession from the newer saved record.
    for(const previousItem of previous.items){const listed=byId.get(previousItem.id),e=twEvidenceOf(previousItem);if(listed&&(previousItem.cancelled||e?.supersededBy))byId.set(previousItem.id,{...listed,cancelled:listed.cancelled===true||previousItem.cancelled===true,taiwan:{...listed.taiwan!,...(e?.supersededBy?{supersededBy:e.supersededBy}:{})}});}
    // Preserve earlier originals when a discovery feed drops old rows. Never
    // use row disappearance as cancellation evidence or force a 90-day purge.
    for(const n of previous.items)if(!byId.has(n.id))byId.set(n.id,n as TwNotice);
    const base=[...byId.values()],prior=old.twOdt?.version===2?old.twOdt.cache:{},cache:Record<string,TwCacheEntry>={};
    const fingerprint=(n:TwNotice)=>JSON.stringify([n.location,n.taiwan?.publication,n.sourceUrl]);
    for(const n of base){const c=prior[n.id];if(c&&c.fingerprint===fingerprint(n))cache[n.id]=c;}
    const ordered=base.filter(n=>twWithinHistory(n,checkedAt)).sort((a,b)=>(b.taiwan?.publication?.value||'').localeCompare(a.taiwan?.publication?.value||''));
    const unseen=ordered.filter(n=>!cache[n.id]);
    const overdue=ordered.filter(n=>cache[n.id]&&checkedAt-cache[n.id].checkedAt>=(cache[n.id].outcome==='error'?3_600_000:6*3_600_000)).sort((a,b)=>Number(cache[b.id].outcome==='parsed')-Number(cache[a.id].outcome==='parsed')||cache[a.id].checkedAt-cache[b.id].checkedAt);
    // Reserve slots for revalidation so a large historical discovery backlog
    // cannot starve current parsed attachments when a file changes in place.
    const first=old.twOdt?.cursor===1?[unseen[0],overdue[0]]:[overdue[0],unseen[0]];
    const scheduled=[...first,unseen[1],overdue[1],...unseen.slice(2),...overdue.slice(2)].filter((n):n is TwNotice=>!!n);
    for(const n of scheduled){
      if(requestBudget.backoff||attempted>=TW_MAX_ARTICLES||Date.now()>deadline-1000)break;attempted++;
      try{
        const articleDeadline=Math.min(deadline,Date.now()+10_000);
        const detail=await get(n.sourceUrl!,256*1024,articleDeadline),html=twText(detail.bytes),body=twPlain(twElement(html,'div',/\bclass=["'][^"']*\barticle-info\b/));
        const detailTitle=twPlain(twElement(html.replace(/<!--[\s\S]*?-->/g,''),'h2',/\bclass=["'][^"']*\bsubtitle\b/));
        if(detailTitle!==n.location)throw new Error('一覧・RSSと公式本文のタイトルが一致しません。取消・更新の可能性を確認してください');
        if(!body)throw new Error('本文が空です');
        const links=twAllDocuments(html,n.sourceUrl!),item:TwNotice={...n,cancelled:n.cancelled===true||prior[n.id]?.enriched?.cancelled===true||prior[n.id]?.lastSuccess?.cancelled===true||twExplicitSelfCancellation(n.location,body),text:`${n.location}\n${body}`,warnings:n.warnings.filter(w=>!w.startsWith('未解析：')),taiwan:{...n.taiwan!,version:2,publisher:'FA',role:'supplement',documents:[{...detail.receipt,extraction:'complete'}],attachments:links.map(a=>({url:a.url,state:'pending'})),bodyComplete:true,semanticComplete:false,unresolved:[]}};
        let odt:Uint8Array|undefined,odtUrl:string|undefined,odtCount=0;const texts:string[]=[],coordinateShapes:Notice['shapes']=[];
        for(const a of item.taiwan!.attachments){
          try{
            const sourceStop=twStopEvidence(undefined,requestBudget);if(sourceStop)throw new Error(sourceStop.reason);
            if(Date.now()>deadline-1000)throw new Error('今回の取得時間上限');
            const r=await get(a.url,links.find(link=>link.url===a.url)?.format==='odt'?512*1024:1536*1024,articleDeadline);
            try{
              const doc=extractTwDocument(r.bytes,r.receipt);item.taiwan!.documents.push(doc.receipt);a.state=doc.review?'complete':'unsupported';a.reason=doc.receipt.reason;texts.push(`原文添付: ${a.url}\n${doc.text}`);
              if(doc.format==='odt'){odtCount++;odt=r.bytes;odtUrl=a.url;coordinateShapes.push(...parseTwOdtPartialGeometry(twOdtContent(r.bytes)).map(shape=>({...shape,sourceReference:a.url})));}
            }catch(e){a.state='unsupported';a.reason=e instanceof Error?e.message:'抽出未対応';item.taiwan!.documents.push({...r.receipt,extraction:'unsupported',reason:a.reason});}
          }catch(e){failed++;a.state='error';a.reason=e instanceof Error?e.message:'添付取得失敗';}
        }
        item.text+='\n\n'+texts.join('\n\n');
        const allText=texts.join('\n'),compact=allText.replace(/\s/g,'');
        const issue=compact.match(/發文日期[：:]中華民國(1\d{2})年(\d{1,2})月(\d{1,2})日/);
        const issueDay=issue?twDay(`${+issue[1]+1911}/${issue[2]}/${issue[3]}`):undefined;
        if(issueDay)item.taiwan!.issue={value:issueDay,precision:'day',evidence:issue![0]};
        const own=compact.match(/發文字號[：:]艦巡防字第(\d+)號/);
        if(own)item.taiwan!.issueReference=`艦巡防字第${own[1]}號`;
        const priorRef=compact.match(/本分署(1\d{2})年(\d{1,2})月(\d{1,2})日艦巡防字第(\d+)號函計達/);
        if(priorRef&&/更新後/.test(compact)&&/PP-10070/.test(compact)&&/PP-3572/.test(compact)&&/PP-3562/.test(compact))item.taiwan!.amendment={kind:'supersedes',targetReference:`艦巡防字第${priorRef[4]}號`,evidence:`${priorRef[0]}。後続公函が射撃船艇をPP-3572・PP-3562へ変更。区域・時間は新ODTそのものから別途確認。`};

        const incomplete=item.taiwan!.attachments.filter(a=>a.state!=='complete');
        const profile=(reviewedBundles as Record<string,{title:string;bodySha256:string;documentSha256:string[]}>)[n.id];
        const bundleVerified=!!profile&&profile.title===n.location&&profile.bodySha256===await twSha256(new TextEncoder().encode(body))&&JSON.stringify([...profile.documentSha256].sort())===JSON.stringify(item.taiwan!.documents.slice(1).map(d=>d.sha256).sort());
        let enriched:TwNotice=item;
        if(incomplete.length){item.taiwan!.unresolved.push(...incomplete.map(a=>`${a.reason||'未取得'}: ${a.url}`));}
        else if(!bundleVerified){item.taiwan!.unresolved.push('本文・タイトル・全添付の組合せが検証済み資料と異なります。変更条件の意味照合が必要です。');}
        else if(odtCount!==1||!odt||!odtUrl){item.taiwan!.unresolved.push('区域・時間に対応する一意のODTを確認できません。');}
        else if(item.cancelled||/取消|撤銷|中止|延期|停止射擊|暫停|延後|順延|改期|除外|不包括|cancelled|canceled|postponed|except/i.test(n.location+'\n'+body+'\n'+texts.join('\n')) || /更新|修正|更正/.test(n.location+'\n'+body)&&!item.taiwan!.amendment){item.taiwan!.unresolved.push('取消・延期等の条件を含みます。対象と効力を確認するまで有効扱いしません。');}
        else{
          try{enriched=enrichTwOdtNotice(item,odt,odtUrl) as TwNotice;enriched.lifecycleUncertain=false;enriched.taiwan={...item.taiwan!,semanticComplete:true,unresolved:[]};}
          catch(e){
            const reason=e instanceof Error?e.message:'ODT日程解析未対応';
            // This branch is reachable only after the exact current title/body/
            // all-attachment bundle passes review and lifecycle checks above.
            try{const geometry=parseTwOdtGeometry(twOdtContent(odt));enriched={...item,start:null,end:null,validityPeriods:[],timeUncertain:true,lifecycleUncertain:false,shapes:[{kind:'polygon',points:geometry.points,inferredClose:true,provenance:'text',sourceReference:odtUrl}],taiwan:{...item.taiwan!,semanticComplete:true,unresolved:[reason,'座標は確認済みですが実施時間は未確定です。現在有効にはしません。']}};}
            catch{item.taiwan!.unresolved.push(reason);}
          }
        }
        if(!enriched.taiwan!.semanticComplete){
          enriched={...twUnknown(enriched,'本文・全添付の照合が未完了です。読取済み座標のみを境界・日時未確定として保持します。'),shapes:enriched.cancelled?[]:coordinateShapes,taiwan:item.taiwan} as TwNotice;
          // A failed recheck of the same attachment does not erase previously
          // read coordinates. Keep their original receipt age and uncertainty;
          // a changed/unlinked attachment or exact lifecycle event cannot use it.
          const failedUrls=new Set(item.taiwan!.attachments.filter(a=>a.state==='error').map(a=>a.url));
          const saved=(previous.items.find(previousItem=>previousItem.id===n.id) as TwNotice|undefined)||prior[n.id]?.enriched;
          if(saved&&failedUrls.size&&!enriched.cancelled&&!enriched.taiwan!.supersededBy){
            const retained=twUncertainNotice(saved,'添付の最新再確認に失敗したため、前回の座標・日時を要確認として保持します。') as TwNotice;
            const shapes=retained.shapes.filter(shape=>!!shape.sourceReference&&failedUrls.has(shape.sourceReference));
            if(shapes.length){
              const documents=retained.taiwan!.documents.filter(d=>failedUrls.has(d.url)||!!d.requestedUrl&&failedUrls.has(d.requestedUrl));
              enriched={...enriched,start:retained.start,end:retained.end,validityPeriods:retained.validityPeriods,shapes:[...enriched.shapes,...shapes],taiwan:{...enriched.taiwan!,documents:[...enriched.taiwan!.documents,...documents],unresolved:[...enriched.taiwan!.unresolved,'添付の保存済み証拠です。現在の内容・有効性は未確認です。']}};
            }
          }
        }
        enriched.warnings=[...new Set([...enriched.warnings,...enriched.taiwan!.unresolved])];
        cache[n.id]={fingerprint:fingerprint(n),checkedAt,outcome:enriched.taiwan!.semanticComplete?'parsed':'unsupported',detail:enriched.taiwan!.semanticComplete?'全文・全添付を照合し明示UTC+8/WGS84を解析':'未解釈条件あり',enriched,lastSuccess:enriched.taiwan!.semanticComplete?enriched:prior[n.id]?.lastSuccess};
      }catch(error){
        failed++;const detail=error instanceof Error?error.message:'本文取得失敗',saved=(previous.items.find(item=>item.id===n.id) as TwNotice|undefined)||prior[n.id]?.enriched||prior[n.id]?.lastSuccess;
        const savedEvidence=saved?twEvidenceOf(saved)||n.taiwan:undefined;
        const enriched=saved?{...twUncertainNotice(saved,`本文再確認失敗：${detail}`),location:n.location,text:`${n.text}\n\n前回取得本文（最新確認失敗）:\n${saved.text}`,taiwan:{...savedEvidence!,semanticComplete:false,bodyComplete:false,unresolved:[...(savedEvidence?.unresolved||[]),detail]}} as TwNotice:undefined;
        cache[n.id]={fingerprint:fingerprint(n),checkedAt,outcome:'error',detail,enriched,lastSuccess:prior[n.id]?.lastSuccess};
      }
    }
    const items=base.map(n=>{
      const c=cache[n.id];if(c?.enriched)return {...c.enriched,cancelled:c.enriched.cancelled===true||n.cancelled===true,taiwan:{...c.enriched.taiwan!,...(n.taiwan?.supersededBy?{supersededBy:n.taiwan.supersededBy}:{})}};
      // Legacy v1 could have ignored a PDF companion. Its active fields cannot
      // survive migration without complete-body/attachment verification.
      return {...twUnknown(n,c?`原文確認失敗：${c.detail}`:'本文・全添付の再確認待ちです。'),taiwan:n.taiwan} as TwNotice;
    });
    const parsed=items.filter(n=>n.taiwan?.semanticComplete).length;
    const result:TwSourceRecord={...(requestBudget.backoff?{taiwanBackoff:requestBudget.backoff}:{}),items:items.map(n=>materializeTwNotice(n,cache[n.id])),revision:3,twOdt:{version:2,cursor:old.twOdt?.cursor===1?0:1,cache,listingReceipt,rssReceipt},status:{...source,state:parsed===items.length&&!failed?'ok':'partial',checkedAt,fetchedAt:checkedAt,count:items.length,pages,detail:`現行一覧${listing.length}件/RSS${rss.length}件。保存${items.length}件、全文・添付照合済み${parsed}件。今回${attempted}件確認、取得失敗・予算保留${failed}件。1回最大6HTTP・本文2件、2時間以上間隔。3か月内と継続中・取消訂正対象を優先。未知PDF等は未対応。${discoveryProblems.join(' / ')} 再配布条件は資料ごとに確認。`}};return result;
  }catch(error){const stop=twStopEvidence(error,requestBudget);return {...previous,...(stop?{taiwanBackoff:stop}:{}),items:previous.items.map(n=>twUncertainNotice(n,'最新原文の照合失敗。保存済み座標・日時を要確認として保持し、現在有効とは断定しません。')),status:{...previous.status,...source,state:'error',checkedAt,count:previous.items.length,pages,detail:`${error instanceof Error?error.message:'台湾取得失敗'}。警告0件とは確認できません。保存済み原文を保持。`}};}
}

export function twAttachments(html: string, base: string): TwAttachment[] {
  const found = new Map<string,TwAttachment>();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]; if (!href) continue;
    const label = decode(m[1]+' '+plain(m[2]));
    try { const u=new URL(decode(href),base);
      if(u.protocol!=='https:'||u.hostname!=='www.fa.gov.tw'||!(u.pathname==='/redirect_file.php'||/\.(?:pdf|odt)$/i.test(u.pathname)))continue;
      const format = /\bODT\b|\.odt(?:\b|[?#])/i.test(label) ? 'odt' : /\bPDF\b|\.pdf(?:\b|[?#])/i.test(label) ? 'pdf' : 'other';
      found.set(u.href,{url:u.href,format});
    } catch { /* malformed official attachment URL */ }
  }
  return [...found.values()];
}

// Bounded recovery from previously extracted private text needs no new request.
// Only complete, successful attachment receipts authorize a coordinate source.
function recoverTwCachedCoordinates(n:Notice):Notice{
 const e=twEvidenceOf(n);
 if(!e||n.cancelled||e.supersededBy||n.shapes.length||typeof n.text!=='string'||n.text.length>2*1024*1024)return n;
 const successful=new Set(e.documents.filter(d=>d.status>=200&&d.status<300&&d.bytes>0&&d.extraction==='complete').flatMap(d=>[d.url,d.requestedUrl].filter((s):s is string=>!!s)));
 const attachments=new Set(e.attachments.map(a=>a.url));
 const markers=[...n.text.matchAll(/(?:^|\n)(?:原文添付|ODT原文): (https:\/\/[^\s]+)\n/g)],found=new Map<string,Notice['shapes'][number]>();
 for(const [i,marker]of markers.entries()){
  const sourceReference=marker[1];if(!successful.has(sourceReference)||!attachments.has(sourceReference))continue;
  const text=n.text.slice(marker.index!+marker[0].length,markers[i+1]?.index);
  for(const shape of parseTwOdtTextPartialGeometry(text)){const value={...shape,sourceReference};found.set(JSON.stringify(value),value);}
 }
 return found.size?{...n,shapes:[...found.values()],timeUncertain:true,lifecycleUncertain:true,warnings:[...new Set([...n.warnings,'保存済み原文の明示WGS84座標を再読取りしました。境界・実施時間・現行性は未確定です。'])]}:n;
}

export function materializeTwNotice(n: Notice, c?: TwCacheEntry): Notice & { maritimeAttachment: MaritimeAttachment } {
n=recoverTwCachedCoordinates(n);
const metadata=twEvidenceOf(n);
if((n as TwNotice).taiwan!==undefined&&!metadata)return {...twPublicNotice(n),maritimeAttachment:{status:'unsupported',detail:'台湾資料の照合メタデータを確認できません'}};
// record.items is the newest materialized state. Cache enrichment may predate
// a failed refresh, cancellation or amendment and must not overwrite its flags.
if(metadata&&(metadata.documents.length>0||c?.enriched&&twEvidenceOf(c.enriched))){const resolved=(n.cancelled||metadata.supersededBy?twUnknown(n,'取消・置換済みのため区域・期間を表示しません。'):n) as TwNotice,e=twEvidenceOf(resolved)!;const errors=c?.outcome==='error'||e.attachments.some(a=>a.state==='error');const complete=e.bodyComplete===true&&e.attachments.length>0&&e.attachments.every(a=>a.state==='complete');return {...resolved,maritimeAttachment:{status:errors?'fetch-error':complete?'fulltext-retained':e.documents.length>1?'unsupported':'unattempted',format:e.semanticComplete?'odt':undefined,sourceUrl:e.attachments[0]?.url||n.sourceUrl,checkedAt:c?.checkedAt,bodyFetchedAt:e.documents.length>1?Math.max(...e.documents.slice(1).map(d=>d.fetchedAt)):undefined,detail:complete?'本文・全添付を照合済み':'本文・全添付の照合は未完了です。',textTruncated:false}};}
const legacyBody=/ODT原文(?:（未解析）)?: https:\/\//.test(n.text);
const legacyDetail=n.warnings.find(w=>w.startsWith('添付処理：'))?.replace(/^添付処理：/,'');
const retained=Boolean(c?.document||c?.enriched||legacyBody);
const maritimeAttachment:MaritimeAttachment={
  status:c?.outcome==='error'?'fetch-error':retained?'fulltext-retained':c||legacyDetail?'unsupported':'unattempted',
  sourceUrl:c?.document?.url||c?.attachments?.find(a=>a.format==='odt')?.url||c?.enriched?.text.match(/ODT原文: (https:\/\/[^\s]+)/)?.[1]||(c?.detail||legacyDetail)?.match(/原文: (https:\/\/[^\s]+)/)?.[1]||n.text.match(/ODT原文(?:（未解析）)?: (https:\/\/[^\s]+)/)?.[1]||n.sourceUrl,
  ...(c?{checkedAt:c.checkedAt,detail:c.detail}: {detail:legacyDetail||(legacyBody?'保存済みODT原文です。':'RSS掲載情報のみ。添付原文は未確認です。')}),
  ...(c?.document?{bodyFetchedAt:c.document.fetchedAt,textTruncated:c.document.truncated}:{}),
  ...(retained||/台湾ODT未解析/.test(c?.detail||legacyDetail||'')?{format:'odt' as const}:c?.reason==='pdf-only'?{format:'pdf' as const}:{})
};
if(!c)return Object.assign({},twUnknown(n,'本文・全添付の再確認待ちです。'),{maritimeAttachment});
if(c.enriched)return Object.assign({},twUnknown(c.enriched,'本文・全添付の再確認待ちです。'),{maritimeAttachment,warnings:[...new Set([...c.enriched.warnings,...n.warnings.filter(w=>w.includes("掲載削除フラグ")),...(c.outcome==='error'?[`ODT再確認失敗：${c.detail}。保存済み解析結果です。`]:[])])]});
return Object.assign({},n,{maritimeAttachment,text:c.document?`${c.fingerprint||n.text}\n\nODT原文（未解析）: ${c.document.url}\n${c.document.text}`:n.text,
  warnings:[...new Set([...n.warnings.filter(w=>!c.document||w!==UNPARSED),`添付処理：${c.detail}`,...(c.document?['ODT原文を保存済み。日時・区域は未解析です。発表日から推定していません。',...(c.document.truncated?['保存原文はサイズ上限で省略されています。']:[])]:[])])]});
}
export function decorateTwSourceItems(record: SourceRecord): Array<Notice & { maritimeAttachment: MaritimeAttachment }> {
  const cache=(record as TwSourceRecord).twOdt?.cache||{};
  return record.items.map(n=>materializeTwNotice(n,cache[n.id]));
}

export function twWorkQueue(ordered:Notice[],cache:Record<string,TwCacheEntry>,cursor:number,now:number):Notice[]{
  if(!ordered.length)return [];
  const rotated=[...ordered.slice(cursor),...ordered.slice(0,cursor)];
  const due=rotated.filter(n=>{const c=cache[n.id];return c&&((c.reason==='odt-unparsed'||c.outcome==='unsupported'&&/台湾ODT未解析/.test(c.detail))&&c.parserVersion!==TW_ODT_PARSER_VERSION||now-c.checkedAt>=(c.outcome==='parsed'?6*3600000:c.outcome==='error'?2*3600000:7*86400000));});
  const urgent=due.filter(n=>cache[n.id].outcome==='parsed'||cache[n.id].outcome==='error'),unseen=ordered.filter(n=>!cache[n.id]);
  return [...new Map([...(urgent.length?urgent:due).slice(0,1),...unseen,...due].map(n=>[n.id,n])).values()].slice(0,TW_MAX_ARTICLES);
}
