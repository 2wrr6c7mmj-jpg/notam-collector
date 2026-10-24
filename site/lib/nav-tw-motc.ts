import type { Notice } from './notam';
import type { NavSource } from './nav-sources';
import type { SourceRecord } from './nav-store';
import { twDay, twGet, twPriorBackoff, twStopEvidence, type TwBackoff, twBoundBudget, twOfficialUrl, twPlain, twText, type TwNotice, type TwReceipt, type TwRequestBudget } from './nav-tw-evidence';

export const twMotcSource: NavSource = { id:'tw-motc',name:'台湾航港局 航行公告（補助）',region:'台湾周辺（公式公告の最新一覧）',country:'TW',parser:'tw-motc',url:'https://www.motcmpb.gov.tw/Information?nodeId=483&siteId=1' };
const HOSTS = ['www.motcmpb.gov.tw','aton.motcmpb.gov.tw'];
const LICENSE = 'https://www.motcmpb.gov.tw/Article?SiteId=1&NodeId=563';
export function twElement(html: string, tag: string, attributes: RegExp): string {
  const openings = new RegExp(`<${tag}\\b[^>]*>`, 'gi'); let match: RegExpExecArray|null;
  while ((match=openings.exec(html))) {
    if (!attributes.test(match[0])) continue;
    const tokens = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'); tokens.lastIndex=openings.lastIndex;
    let depth=1, t:RegExpExecArray|null;
    while ((t=tokens.exec(html))) { depth += /^<\//.test(t[0]) ? -1 : 1; if (!depth) return html.slice(openings.lastIndex,t.index); }
    throw new Error('台湾記事HTMLが途中で切れています');
  }
  throw new Error('台湾記事HTMLの本文領域を確認できません');
}
export type TwMotcLink = {url:string;title:string;published:string;modified?:string};
export function parseTwMotcList(html: string): TwMotcLink[] {
  const table=twElement(html,'table',/\bclass=["'][^"']*\btable-information\b/), found:TwMotcLink[]=[];
  for (const m of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (/<th\b/i.test(m[1])) continue;
    const pub=m[1].match(/<td\b[^>]*data-th=["']發布日期["'][^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const link=m[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!pub || !link) throw new Error('台湾航港局一覧に未解釈の行があります');
    const published=twDay(twPlain(pub)), url=twOfficialUrl(link[1],['www.motcmpb.gov.tw'],twMotcSource.url), title=twPlain(link[2]);
    if(!published || !title || !/^\/Information\/Detail\/[\da-f-]{36}$/i.test(new URL(url).pathname)) throw new Error('台湾航港局一覧の日付・URL形式');
    if (found.some(x=>x.url===url)) throw new Error('台湾航港局一覧URLが重複しています');
    found.push({url,title,published});
  }
  if (!found.length || found.length>100) throw new Error('台湾航港局一覧が空または未対応です');
  return found;
}
export function parseTwMotcDetail(html: string, listing: TwMotcLink): TwNotice {
  if (/Access Denied|Just a moment|verify you are human/i.test(html)) throw new Error('台湾公式本文を取得できません');
  const body=twPlain(twElement(html,'div',/\bid=["']content["']/)), info=twPlain(twElement(html,'div',/\bclass=["']info["']/));
  const title=twPlain(twElement(html,'h3',/\bclass=["'][^"']*\btitle\b/).replace(/<span\b[\s\S]*$/i,''));
  const date=twDay(info.match(/發布日期[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1]||'');
  if (!body || !date || title!==listing.title || date!==listing.published) throw new Error('台湾記事と一覧のタイトル・掲載日が一致しません');
  const downloads=html.match(/<!-- download -->([\s\S]*?)<!-- gallery -->/)?.[1];
  if (downloads===undefined) throw new Error('台湾記事の添付領域が未確認です');
  const urls:string[]=[];
  for(const m of downloads.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) urls.push(twOfficialUrl(m[1],HOSTS,listing.url));
  const attachments=[...new Set(urls)].map(url=>({url,state:'pending' as const}));
  const issue=body.match(/(?:依據|依據函文)[：:]?[\s\S]{0,80}?(1\d{2})年(\d{1,2})月(\d{1,2})日[^\n。]*函/);
  const issueDay=issue?twDay(`${+issue[1]+1911}/${issue[2]}/${issue[3]}`):undefined;
  const unresolved=attachments.length?['全添付資料の読取り・照合が未完了です。','原文本文には時刻・座標系の明示がない場合があります。']:['本文の活動期間・区域の意味解析は未完了です。'];
  return {id:`TW-MOTC-${new URL(listing.url).pathname.split('/').at(-1)}`,location:title,text:[title,`掲載日: ${date}`,body,'添付資料:',...attachments.map(a=>a.url)].join('\n'),issued:null,start:null,end:null,permanent:false,purpose:/射擊|實彈|操演|軍事|飛彈|火箭/.test(title)?'firing':'other',shapes:[],validityPeriods:[],timeUncertain:true,sourceCountry:'TW',sourceName:twMotcSource.name,sourceUrl:listing.url,
    warnings:['掲載日は日付精度です。発表時刻・活動開始時刻には転用していません。',...unresolved],
    taiwan:{version:2,publisher:'MOTC',role:'supplement',publication:{value:date,precision:'day',evidence:`發布日期: ${date}`},issue:issueDay?{value:issueDay,precision:'day',evidence:issue![0]}:undefined,documents:[],attachments,bodyComplete:true,semanticComplete:false,rights:{status:'metadata-open',url:LICENSE,detail:'航港局政府網站資料開放宣告。明示された第三者資料・除外権利を除き、出典表示が必要です。添付の個別権利は別途確認。'},unresolved},
  };
}
type Cached = {fingerprint:string;checkedAt:number;item:TwNotice;lastSuccess?:TwNotice};
type MotcRecord = SourceRecord & {taiwanBackoff?:TwBackoff;twMotc?:{version:1;cache:Record<string,Cached>;listingReceipt?:TwReceipt}};
export async function collectTwMotcSource(source:NavSource,previous:SourceRecord,fetcher:typeof fetch=fetch,budget?:TwRequestBudget):Promise<SourceRecord>{
  const backoff=twPriorBackoff(previous as SourceRecord&{taiwanBackoff?:TwBackoff});if(backoff)return {...previous,status:{...previous.status,detail:`発表元の再試行待機中（${new Date(backoff.until).toISOString()}まで）。保存データを保持。`}};
  const requestBudget=twBoundBudget(budget,7);
  const checkedAt=Date.now(),deadline=checkedAt+25_000;let pages=0,failed=0;
  try {
    const list=await twGet(source.url,['www.motcmpb.gov.tw'],fetcher,deadline,512*1024,requestBudget,'listing'); pages++;
    const links=parseTwMotcList(twText(list.bytes));list.receipt.extraction='complete';
    const prior=(previous as MotcRecord).twMotc?.cache||{},cache:Record<string,Cached>={...prior};
    const key=(l:TwMotcLink)=>`${l.title}\n${l.published}`;
    // Fetch update/cancellation bodies first, then unattempted and least recently
    // checked bodies. Source health remains partial until full attachments are read.
    const ordered=[...links].sort((a,b)=>{
      const ap=/更新|更正|取消|撤銷/.test(a.title)?1:0,bp=/更新|更正|取消|撤銷/.test(b.title)?1:0;
      const ac=prior[a.url]?.checkedAt||0,bc=prior[b.url]?.checkedAt||0;
      const pendingA=!prior[a.url]||prior[a.url].fingerprint!==key(a),pendingB=!prior[b.url]||prior[b.url].fingerprint!==key(b);
      return Number(pendingB)-Number(pendingA)||(pendingA&&pendingB?(bp-ap)||(b.published.localeCompare(a.published)):(ac-bc));
    });
    let processed=0;
    for(const link of ordered){
      if(requestBudget.backoff||processed>=6||Date.now()>deadline-1000)break;processed++;
      try {
        const page=await twGet(link.url,['www.motcmpb.gov.tw'],fetcher,deadline,1024*1024,requestBudget,'body'); pages++;
        const item=parseTwMotcDetail(twText(page.bytes),link);page.receipt.extraction='complete';item.taiwan!.documents.push(page.receipt);
        // Fetch every listed attachment for a selected record, or leave explicit
        // pending/error receipts. Never parse only the easiest file and call it complete.
        for(const attachment of item.taiwan!.attachments){
          if(requestBudget.backoff||Date.now()>deadline-1000){attachment.state='pending';attachment.reason='今回の取得時間上限';continue;}
          try {
            const doc=await twGet(attachment.url,HOSTS,fetcher,deadline,1024*1024,requestBudget,'body');pages++;
            doc.receipt.extraction='unsupported';doc.receipt.reason='PDF・その他添付の全文抽出器は未統合です';
            attachment.state='unsupported';attachment.reason=doc.receipt.reason;item.taiwan!.documents.push(doc.receipt);
          }catch(error){failed++;attachment.state='error';attachment.reason=error instanceof Error?error.message:'添付取得失敗';}
        }
        item.warnings.push(...item.taiwan!.attachments.filter(a=>a.state!=='complete').map(a=>`添付未完了：${a.reason||'未取得'} (${a.url})`));
        cache[link.url]={fingerprint:key(link),checkedAt,item,lastSuccess:item};
      }catch(error){
        failed++;
        // If the listing changed, the old parsed version cannot supply fresh
        // interpretation. Preserve it separately, with only safe unknown fields.
        const previousItem=cache[link.url]?.lastSuccess||cache[link.url]?.item;
        cache[link.url]={fingerprint:key(link),checkedAt,lastSuccess:previousItem,item:{...(previousItem||{}),...(previousItem?.taiwan?{taiwan:{...previousItem.taiwan,bodyComplete:false,semanticComplete:false}}:{}),id:previousItem?.id||`TW-MOTC-${new URL(link.url).pathname.split('/').at(-1)}`,location:link.title,text:`${link.title}\n掲載日: ${link.published}${previousItem?`\n\n前回取得本文（最新確認失敗）:\n${previousItem.text}`:""}`,issued:null,start:null,end:null,permanent:false,purpose:/射擊|實彈|操演/.test(link.title)?'firing':'other',shapes:[],validityPeriods:[],timeUncertain:true,sourceCountry:'TW',sourceName:source.name,sourceUrl:link.url,warnings:[`本文取得失敗：${error instanceof Error?error.message:'不明'}。変更済み本文を古い区域・日程で補っていません。`]}};
      }
    }
    const current=links.map(l=>cache[l.url]?.fingerprint===key(l)?cache[l.url].item:{id:`TW-MOTC-${new URL(l.url).pathname.split('/').at(-1)}`,location:l.title,text:`${l.title}\n掲載日: ${l.published}`,issued:null,start:null,end:null,permanent:false,purpose:/射擊|實彈|操演/.test(l.title)?'firing':'other',shapes:[],validityPeriods:[],timeUncertain:true,sourceCountry:'TW',sourceName:source.name,sourceUrl:l.url,warnings:['一覧取得済み。本文・添付は未取得です。']} as Notice);
    const currentUrls=new Set(current.map(n=>n.sourceUrl));
    const retained=previous.items.filter(n=>!currentUrls.has(n.sourceUrl));
    const result:MotcRecord={...(requestBudget.backoff?{taiwanBackoff:requestBudget.backoff}:{}),items:[...current,...retained],revision:1,twMotc:{version:1,cache,listingReceipt:list.receipt},status:{...source,state:'partial',checkedAt,fetchedAt:checkedAt,count:current.length+retained.length,pages,detail:`最新一覧${links.length}件。本文確認${current.filter(n=>(n as TwNotice).taiwan?.bodyComplete).length}件。全添付の意味解析は未完了。取得失敗${failed}件。初回ページのみで全公告網羅ではありません。`}};
    return result;
  }catch(error){const stop=twStopEvidence(error,requestBudget);return {...previous,...(stop?{taiwanBackoff:stop}:{}),status:{...previous.status,...source,state:'error',checkedAt,count:previous.items.length,pages,detail:`${error instanceof Error?error.message:'航港局取得失敗'}。警告0件とは確認できません。保存分を保持。`}};}
}
