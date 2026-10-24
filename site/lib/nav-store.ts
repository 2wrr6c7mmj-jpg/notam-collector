import {collectionProgress,withCollectionProgress} from './nav-collection-progress';
import {collectNavareaSource,reconcileNavarea,projectNavareaPublicNotice,projectNavareaPublicRecord,type NavareaRecord,type NavareaNotice} from './navarea-pacific';
import {readPrivateNavSources,writePrivateNavSource} from './nav-private-source-store';
import {publicFactNotice} from './nav-facts-only';
import {collectTwMoaSource,restoreTwMoaRecord,serializeTwRecord} from './nav-tw-moa';
import {collectTwMotcSource} from './nav-tw-motc';
import {reconcileTwVersions,twWithinHistory,twPublicNotice} from './nav-tw-evidence';
import {selectTwPublicHistory,WINDOWED_TAIWAN_SOURCES} from './nav-tw-public-history';
import {admitMaritimeCollection,maritimeInvocationBudget,type NavInvocationBudget} from './nav-collection-budget';
import {collectChinaFirstPage,readChinaFirstPageSources,writeChinaFirstPageSource,isChinaFirstPageNotice,projectChinaFirstPageNotice} from './nav-china-first-page';
import {englishUtcMaritimeAnalysis} from "./nav-english-utc-periods";
import {navPeriodAnalysis} from "./nav-period";
import {collectKoreaMaritime, recoverKoreaSchedule} from "./nav-korea";
import krInitial from "./kr-initial.json";
import phInitial from "./ph-initial.json";
import twInitial from "./tw-initial.json";
import {collectPhilippinesMaritime, navphilShapes} from "./nav-philippines";
import {collectTwFisheriesSource, decorateTwSourceItems} from "./nav-tw-fisheries";
import jcgInitial from "./jcg-initial.json";
import {collectJcgSource, jcgShapes, jcgValidity} from "./nav-jcg";
import snapshot from "./nav-warning-snapshot.json";
import { navShapes, navWarningToNotice, unmappedWarning, unknownPeriodWarning, multiplePeriodWarning, navPeriodWarnings, partialPeriodWarning, navGeometryWarnings } from "./nav-warning";
import { articleLinks, linksIn, mergeNavItems, nextPage, parseNavArticle, navListingUrl } from "./nav-ingest";
import { navSources, getNavSources, MARITIME_SOURCE_PROFILE, type MaritimeSourceProfile, type NavSource, type SourceStatus } from "./nav-sources";
import type { Notice } from "./notam";
import { acquireLease, releaseLease } from "./update-lock";

export type SourceRecord = { status: SourceStatus; items: Notice[]; revision?: number; listingUrl?: string; continuation?: string; pendingArticles?: string[]; retryArticles?: string[] };
const REVISION = 7;
const HOUR = 3600000, HISTORY = 90 * 86400000;
// Keep wall time and concurrency unchanged. A shared fetch budget also bounds
// discovery and pagination, while allowing fast sources more useful body work.
const MAX_PAGES = 8, MAX_ARTICLES = 40, MAX_FETCHES = 48, CONCURRENCY = 3;
const MAX_RETRIES = 6, RETRY_MS = 4000, RUN_MS = 25000;
function sourceUrl(url: string, source: NavSource) {
  try {
    const target = new URL(url), origin = new URL(source.url);
    return /^https?:$/.test(target.protocol) && target.hostname.replace(/^www\./, "") === origin.hostname.replace(/^www\./, "");
  } catch { return false; }
}
function initial(source: NavSource): SourceRecord {
  if(source.id === "kr-gicoms") return {...krInitial,items:krInitial.items as unknown as Notice[],status:{...krInitial.status,...source}} as SourceRecord;
  if(source.id === "ph-namria") return {...phInitial,items:phInitial.items as Notice[],status:{...phInitial.status,...source}} as SourceRecord;
  if(source.id === "tw-fisheries") return {...twInitial,items:twInitial.items as Notice[],status:{...twInitial.status,...source}} as SourceRecord;
  if(source.id === "jcg-navarea11") return {...jcgInitial,items:jcgInitial.items as Notice[],status:{...jcgInitial.status,...source,state:"partial",detail:"初回に確認できた公開原文を表示。取得できた一部の情報です。次の更新で残りを確認します。"}} as SourceRecord;
  const saved = source.id === "zj-web" ? snapshot.map(navWarningToNotice) : [];
  return { items: saved, status: { ...source, state: "pending", checkedAt: null, fetchedAt: saved.length ? snapshot[0].snapshotAt : null, count: saved.length, pages: 0, detail: saved.length ? "初期保存データ。自動更新は未確認" : "未取得。掲載件数は不明" } };
}
function guardedSource(source:NavSource){return source.regionalPageLimit===2||['tw-fisheries','tw-moa-ship','tw-motc','navarea-public'].includes(source.parser||'');}
async function records(db: D1Database,catalog:NavSource[]=navSources) {
  if(!catalog.length)return [];
  const ids=catalog.map(s=>s.id),scope=new Set(ids);
  const rows = await db.prepare(`SELECT id, data FROM nav_sources WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<{ id: string; data: string }>();
  const byId = new Map(rows.results.filter(row=>scope.has(row.id)).map((row) => [row.id, JSON.parse(row.data) as SourceRecord]));
  const shadowRead=await readChinaFirstPageSources(db,ids);for(const shadow of shadowRead.records)byId.set(shadow.status.id,shadow);for(const id of shadowRead.errors){const source=catalog.find(s=>s.id===id)!,saved=byId.get(id)||initial(source);byId.set(id,{...saved,status:{...saved.status,state:'error',detail:'先頭ページの保存形式を検証できません。従来の保存済み原文を保持。'}});}
  const privateRead=await readPrivateNavSources(db,catalog.map(s=>s.id));
  for(const record of privateRead.records){const source=catalog.find(s=>s.id===record.status.id)!;byId.set(source.id,{...record,status:{...record.status,...source}});}
  for(const id of privateRead.errors){const source=catalog.find(s=>s.id===id)!,saved=byId.get(id)||initial(source);byId.set(id,{...saved,status:{...saved.status,state:'error',detail:'新しい保存資料の形式を検証できません。従来の保存済み原文を保持。'}});}
  return Promise.all(catalog.map(async source=>restoreTwMoaRecord(byId.get(source.id)||initial(source))));
}
export async function navPayload(db: D1Database,profile:MaritimeSourceProfile=MARITIME_SOURCE_PROFILE,{summaryOnly=false}:{summaryOnly?:boolean}={}) {
  const catalog=getNavSources(profile),stored=await records(db,catalog),now=Date.now();
  const data:SourceRecord[]=stored.map(record=>{if(record.status.parser!=='navarea-public')return record;const valid=record.items.filter((n):n is NavareaNotice=>projectNavareaPublicNotice(n as NavareaNotice)!==null),listed=new Set(valid.filter(n=>n.navareaEvidence.observedInCurrentList===true).map(n=>n.id)),rejected=record.items.length-valid.length;const prepared={...record,items:reconcileNavarea(valid,listed,now)} as NavareaRecord;const projected=projectNavareaPublicRecord(prepared);if(!projected)return {...record,items:[],status:{...record.status,state:'error' as const,detail:'NAVAREA公開形式は未確認。内部の保存原文を保持。警報0件とは断定しません。'}};if(rejected)projected.status={...projected.status,state:'partial',detail:`${rejected}件の公開形式を確認できません。内部の原文を保持。警報0件とは断定しません。`};return projected;});
  const sources=data.map(({status},index)=>({...status,collectionProgress:collectionProgress(stored[index])}));
  const all=data.flatMap(source=>(source.status.id==='tw-fisheries'?decorateTwSourceItems(source):source.items).map(item=>({...item,sourceId:source.status.id,sourceCountry:item.sourceCountry||source.status.country||'CN'})));
  const twUnique=new Map<string,typeof all[number]>();for(const item of all.filter(n=>n.sourceCountry==='TW'))twUnique.set(item.sourceId+'|'+item.id,item);
  const twItems=selectTwPublicHistory(reconcileTwVersions([...twUnique.values()]),now).map(item=>{const id=(item as Notice&{sourceId:string}).sourceId,source=catalog.find(s=>s.id===id)!,projected=publicFactNotice(twPublicNotice(item,now),source);if(projected.taiwan)projected.taiwan.historyState=twWithinHistory(item,now)?'default-view':'retained-history';return projected;});
  for(const source of sources){if(!WINDOWED_TAIWAN_SOURCES.has(source.id))continue;const count=twItems.filter(n=>n.sourceId===source.id).length;source.detail+=` 公開は直近3か月と継続・取消訂正・既知参照・日付不明等の${count}件。内部保存${source.count}件は保持。公開対象外を取消・無効とは判定していません。`;}
  const ordinarySources = mergeNavItems(all.filter(item=>item.sourceCountry!=='TW'));
  // The coordinator only consumes count/status. Membership and cancellation
  // reconciliation still run; repeated geometry/time parsing does not.
  const ordinaryItems = summaryOnly ? ordinarySources : ordinarySources.map((item) => {
    const sourceId=(item as Notice&{sourceId?:string}).sourceId,source=catalog.find(s=>s.id===sourceId);
    if(source?.parser==='navarea-public')return publicFactNotice(item,source);
    if(isChinaFirstPageNotice(item))return projectChinaFirstPageNotice(item);
    // Re-read saved originals after parser repairs without claiming a new fetch.
    if (item.sourceCountry === "JP" || item.sourceCountry === "PH") {
      const shapes = item.cancelled ? [] : item.sourceCountry === "JP" ? jcgShapes(item.text) : navphilShapes(item.text);
      const warnings = [...item.warnings];
      if (/\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS)\b/i.test(item.text)) warnings.push("除外条件を含むため区域は未確定です。座標のみ表示します。");
      if(item.sourceCountry === "JP") {
        const validity=jcgValidity(item.text,item.issued);
        const kept=warnings.filter(w=>!/^活動時間は|^活動期間を安全|^活動年の照合|^活動期間の年月日|^日毎の開始|^主日程の明示|^取消予定時刻が/.test(w));
        return {...item,shapes,start:validity.start,end:validity.end,validityPeriods:validity.validityPeriods,timeUncertain:validity.timeUncertain,warnings:[...new Set([...kept,...validity.warnings])]};
      }
      return {...item, shapes, warnings: [...new Set(warnings)]};
    }
    if (item.sourceCountry === "KR") return recoverKoreaSchedule(item);
    if (item.sourceCountry && item.sourceCountry !== "CN") return item;
    const shapes = item.cancelled ? [] : navShapes(item.text);
    const analysis=navPeriodAnalysis(item.text,item.issued);
    const english=analysis.periods.length ? null : englishUtcMaritimeAnalysis(item.text,item.issued);
    const validityPeriods=analysis.periods.length?analysis.periods:english?.periods??[];
    const dates=validityPeriods.length?{start:Math.min(...validityPeriods.map(p=>p.start)),end:Math.max(...validityPeriods.map(p=>p.end))}:{start:null,end:null};
    const timeUncertain=!validityPeriods.length || (analysis.periods.length?analysis.unparsedClauses.length>0:english?.timeUncertain!==false);
    const warnings = item.warnings.filter((warning) => warning !== unmappedWarning && warning !== unknownPeriodWarning && warning !== multiplePeriodWarning && !warning.startsWith(partialPeriodWarning));
    if (!item.cancelled && !shapes.length) warnings.unshift(unmappedWarning);
    if (dates.start === null || dates.end === null) warnings.push(unknownPeriodWarning);
    warnings.push(...navPeriodWarnings(item.text,item.issued),...navGeometryWarnings(item.text,shapes));
    if (validityPeriods.length > 1) warnings.push(multiplePeriodWarning);
    if(english?.periods.length) warnings.push(...english.warnings);
    return { ...item, ...dates, shapes, validityPeriods, timeUncertain, warnings:[...new Set(warnings)] };
  });
  const items=[...ordinaryItems,...twItems];
  const oldest = sources.filter((s) => s.count > 0).map((s) => s.fetchedAt || 0);
  return { maritimeContract:{schemaVersion:1 as const,profile}, items, sources, fetchedAt: oldest.length ? Math.min(...oldest) : null, checkedAt: Math.max(...sources.map((s) => s.checkedAt || 0)) || null,
    stale: sources.some((s) => s.state === "error" || s.state === "pending" || !(s.validatedAt || s.fetchedAt) || Date.now() - (s.validatedAt || s.fetchedAt || 0) > HOUR * 2),
    coverage: "中国海事局、JCG NAVAREA XI、フィリピンNAMRIA、台湾漁業署RSS、韓国GICOMS（各取得状況・未対応範囲を参照）", refreshMinutes: 60, historyDays: 90,
    warning: "すべての国・地域、全地方局の警告を網羅するものではありません。広域警報の発表国と対象海域は異なります。取得状況と未対応範囲を確認してください。" };
}
async function officialHtml(url: string, fetcher: typeof fetch, deadline = Date.now() + 10000, requestMs=8000) {
  const response = await fetcher(url, { headers: { Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(Math.max(1, Math.min(requestMs, deadline - Date.now()))), redirect: "follow" });
  if (!response.ok) throw new Error(`公式サイト HTTP ${response.status}`);
  if (response.url && new URL(response.url).hostname.replace(/^www\./, "") !== new URL(url).hostname.replace(/^www\./, "")) throw new Error("公式ページ以外へ転送されました");
  const html = await response.text();
  if (/ACCESS DENIED|<title[^>]*>\s*(?:安全验证|Access Denied|Just a moment)|机器人验证/i.test(html)) throw new Error("公式サイトのアクセス制限");
  if (html.length > 2000000) throw new Error("ページサイズ上限");
  return html;
}
export async function collectSource(source: NavSource, previous: SourceRecord, fetcher: typeof fetch = fetch): Promise<SourceRecord> {
  const checkedAt = Date.now(), deadline = checkedAt + RUN_MS;
  const sameListing = previous.status.url === source.url;
  let listingUrl = sameListing && previous.listingUrl && sourceUrl(previous.listingUrl, source) ? previous.listingUrl : source.url;
  let continuation = sameListing && previous.continuation && sourceUrl(previous.continuation, source) ? previous.continuation : undefined;
  const known = new Map(previous.items.map((item) => [item.sourceUrl, item]));
  const cleanQueue = (queue: string[] = []) => [...new Set(queue.filter((url) => sourceUrl(url, source) && !navListingUrl(url) && url!==source.url))];
  const retryArticles = cleanQueue(sameListing ? previous.retryArticles : []);
  const retrySet = new Set(retryArticles);
  const retryCount = Math.min(MAX_RETRIES, retryArticles.length);
  const pendingArticles = cleanQueue(sameListing ? previous.pendingArticles : []).filter((url) => !known.has(url) && !retrySet.has(url));
  const queued = new Set(pendingArticles), attempted = new Set<string>();
  const found: Notice[] = [], seenPages = new Set<string>();
  let pages = 0, requests = 0, articles = 0, failed = 0, cached = 0, pdfs=0;
  let problem: string | undefined;
  const bodyErrors:string[]=[];
  const hasBudget = () => Date.now() < deadline - 1000 && requests < MAX_FETCHES;
  const canReadBody = () => hasBudget() && articles < MAX_ARTICLES;
  const readHtml = async (url: string) => {
    if (!hasBudget()) throw new Error("取得時間・リクエスト数の上限");
    requests++;
    return officialHtml(url, fetcher, deadline, source.id==='zj-web'?16000:8000);
  };
  const queueLinks = (html: string, url: string) => {
    const links = articleLinks(html, url, source.includeNotices);
    for (const link of links) {
      if (known.has(link.url)) { cached++; continue; }
      if (!queued.has(link.url) && !retrySet.has(link.url) && !attempted.has(link.url)) {
        pendingArticles.push(link.url); queued.add(link.url);
      }
    }
    return links;
  };
  const fetchBodies = async (urls: string[], bodyDeadline = deadline) => {
    // The caller removes only a batch that fits both budgets. Each URL is tried
    // once per run; failures rotate through a separate persisted retry queue.
    articles += urls.length; requests += urls.length;
    await Promise.all(urls.map(async (url) => {
      attempted.add(url);
      try {
        const html=await officialHtml(url, fetcher, bodyDeadline);
        let item=parseNavArticle(html,url,source);
        if(!item&&source.id==='cj-web'){
          const {parseNavPdfArticle}=await import('./nav-china-pdf');
          item=await parseNavPdfArticle(html,url,source,async target=>{
            if(!hasBudget()||pdfs>=2)throw Error('PDF extraction share deferred');
            pdfs++;requests++;
            return fetcher(target,{redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,bodyDeadline-Date.now())))});
          });
        }
        if (!item) throw new Error("警告本文を確認できません");
        found.push(item); known.set(url, item); retrySet.delete(url);
      } catch (error) {
        const code=error instanceof Error?error.message: "本文取得失敗";
        if(bodyErrors.length<3)bodyErrors.push(new URL(url).pathname+": "+code.slice(0,140));
        failed++;
        if (!retrySet.has(url)) { retrySet.add(url); retryArticles.push(url); }
      }
    }));
  };
  const batchSize = (maximum = CONCURRENCY) => Math.max(0, Math.min(maximum, CONCURRENCY, MAX_ARTICLES - articles, MAX_FETCHES - requests));
  try {
    let html = await readHtml(listingUrl);
    if (source.discover && !(sameListing && previous.listingUrl) && !articleLinks(html, listingUrl, source.includeNotices).length) {
      const lists = linksIn(html, listingUrl).filter((link) => /^(?:航行警告|航行通警告|航行警通告|航行警[（(]通[）)]告)$/.test(link.title.replace(/\s/g, "")));
      if (!lists.length) throw new Error("公開ページの警告一覧を確認できません（移転・動的表示の可能性）");
      listingUrl = lists[0].url; html = await readHtml(listingUrl);
    }
    pages++; seenPages.add(listingUrl);
    const head = queueLinks(html, listingUrl);
    // Always enumerate the whole first page before resuming a historical page.
    // Its unfetched bodies stay queued even when that page changes next time.
    if (!head.length) throw new Error("一覧の警告記事を読み取れません（0件とは断定できません）");
    // An empty cursor with queued bodies means the last listing was already
    // reached. Finish that queue before beginning another historical scan.
    if (continuation === listingUrl || (!continuation && !(sameListing && previous.pendingArticles?.length))) {
      continuation = nextPage(html, listingUrl) || undefined;
    }

    // Failed current publications must not wait behind hundreds of historical
    // failures. Reserve up to two of six retry slots for historical progress.
    const currentFailures=head.map(link=>link.url).filter(url=>retrySet.has(url));
    const leading=currentFailures.slice(0,Math.max(0,MAX_RETRIES-2));
    if(leading.length){const selected=new Set(leading);retryArticles.splice(0,retryArticles.length,...leading,...retryArticles.filter(url=>!selected.has(url)));}

    // Refresh at most two cached leading articles, leaving the remaining body
    // budget for queued work. A cached result alone never advances fetchedAt.
    const refresh = head.slice(0, 2).map((link) => link.url).filter((url) => known.has(url) && !retrySet.has(url));
    if (refresh.length && canReadBody()) await fetchBodies(refresh.slice(0, batchSize(2)));

    // Reserve a small fair share for old failures, not the entire run. Removing
    // an attempted failure from the front and appending it avoids retry starvation.
    let retried = 0;
    const retryDeadline = Math.min(deadline, Date.now() + RETRY_MS);
    while (retried < retryCount && canReadBody() && Date.now() < retryDeadline - 1000) {
      const urls = retryArticles.splice(0, Math.min(batchSize(), retryCount - retried));
      for (const url of urls) retrySet.delete(url);
      retried += urls.length;
      await fetchBodies(urls, retryDeadline);
    }
    while (hasBudget()) {
      if (pendingArticles.length) {
        if (!canReadBody()) break;
        const urls = pendingArticles.splice(0, batchSize());
        for (const url of urls) queued.delete(url);
        await fetchBodies(urls);
        continue;
      }
      if (!continuation || pages >= MAX_PAGES || articles >= MAX_ARTICLES) break;
      const pageUrl = continuation;
      if (seenPages.has(pageUrl)) throw new Error("公式一覧のページ送りが循環しています");
      // Keep this cursor until its listing was read successfully. A network
      // failure must not reset progress or erase pending work from earlier pages.
      html = await readHtml(pageUrl);
      pages++; seenPages.add(pageUrl);
      if (!queueLinks(html, pageUrl).length) throw new Error("続きの一覧から警告記事を読み取れません");
      continuation = nextPage(html, pageUrl) || undefined;
    }
  } catch (error) {
    problem = error instanceof Error ? error.message : "公式ページを取得できません";
  }
  // A refreshed article can be shorter after an official correction. Replace
  // its previous URL version before deduplication rather than keeping stale text.
  const replacedUrls = new Set(found.map((item) => item.sourceUrl));
  let items = mergeNavItems([...previous.items.filter((item) => !replacedUrls.has(item.sourceUrl)), ...found]);
  if (!problem && found.length) items = items.filter((item) => (item.end !== null && item.end > checkedAt) || !item.issued || checkedAt - item.issued < HISTORY);
  const outstanding = Boolean(continuation || pendingArticles.length || retryArticles.length);
  const state: SourceStatus["state"] = problem && !found.length ? "error" : problem || outstanding || failed ? "partial" : "ok";
  const detail = `${pages}ページ確認・本文取得${found.length}件・保存済み掲載${cached}件` +
    `${failed ? `・本文失敗${failed}件` : ""}${pendingArticles.length ? `・本文待ち${pendingArticles.length}件` : ""}` +
    `${retryArticles.length ? `・再試行待ち${retryArticles.length}件` : ""}${continuation ? "・未確認ページあり" : ""}` +
    `${problem ? `・${problem}` : ""}${bodyErrors.length?`・本文診断 ${bodyErrors.join("; ")}`:""}。${problem ? "取得できた原文と前回データを保持。" : ""}全分支局の網羅は未確認`;
  return { items, revision: REVISION, listingUrl, continuation, pendingArticles, retryArticles, status: {
    ...source, state, checkedAt, fetchedAt: found.length ? checkedAt : previous.status.fetchedAt, count: items.length, pages, detail,
  } };
}
export async function refreshNavSource(db: D1Database, id: string, fetcher: typeof fetch = fetch, force = false, invocation?:NavInvocationBudget,profile:MaritimeSourceProfile=MARITIME_SOURCE_PROFILE) {
  const catalog=getNavSources(profile);
  const index = catalog.findIndex((source) => source.id === id);
  if (index < 0) throw new Error("発表元が登録されていません");
  // A single-source update must not materialize every region's raw originals,
  // historical versions and HTML caches in the same Worker isolate.
  const previous = (await records(db,[catalog[index]]))[0], now = Date.now();
  const backoff=previous as SourceRecord&{collectionRetryAfter?:number;taiwanBackoff?:{until?:number};navareaBackoff?:{nextAllowedAt?:number}};
  const retryAfter=Math.max(backoff.collectionRetryAfter||0,backoff.taiwanBackoff?.until||0,backoff.navareaBackoff?.nextAllowedAt||0);
  if(Number.isFinite(retryAfter)&&retryAfter>now){if(invocation&&guardedSource(catalog[index]))invocation.pendingListings=Math.max(0,invocation.pendingListings-2);return previous;}
  const cooldown = (previous.continuation || previous.pendingArticles?.length || previous.retryArticles?.length) ? 30000 : force ? 120000 : HOUR;
  if (previous.revision === REVISION && previous.status.checkedAt && now - previous.status.checkedAt < cooldown) {if(invocation&&guardedSource(catalog[index]))invocation.pendingListings=Math.max(0,invocation.pendingListings-2);return previous;}
  if (!await acquireLease(db, `nav:${id}`, now, catalog[index].regionalPageLimit===2?135000:35000)) {if(invocation&&guardedSource(catalog[index]))invocation.pendingListings=Math.max(0,invocation.pendingListings-2);return previous;}
  try {
    if(catalog[index].regionalPageLimit===2){
      const shared=invocation||maritimeInvocationBudget();
      const progress=(previous.status as SourceStatus&{collection?:{currentPageComplete?:boolean;allCurrentBodiesValidatedThisPass?:boolean}}).collection;
      const admission=await admitMaritimeCollection(db,id,'chinaCentral',shared,now,progress?.currentPageComplete!==true||progress?.allCurrentBodiesValidatedThisPass!==true);
      if(!admission.admitted){if(invocation)shared.pendingListings=Math.max(0,shared.pendingListings-2);return {...previous,status:{...previous.status,state:'partial' as const,detail:`地域別の取得間隔で待機中。次回受付 ${new Date(admission.nextAllowedAt).toISOString()}。保存済み原文を保持。`}};}
      try{const collected=await collectChinaFirstPage(catalog[index],previous,fetcher,REVISION,data=>writeChinaFirstPageSource(db,data,{id:`nav:${id}`,startedAt:now}),admission.budget);const data=withCollectionProgress(previous,collected,now);await writeChinaFirstPageSource(db,data,{id:`nav:${id}`,startedAt:now});return data;}finally{admission.budget.finish();}
    }
    const source=catalog[index];
    if(['tw-fisheries','tw-moa-ship','tw-motc'].includes(source.parser||'')){
      const admission=await admitMaritimeCollection(db,id,'taiwan',invocation||maritimeInvocationBudget(),now);
      if(!admission.admitted){if(invocation)invocation.pendingListings=Math.max(0,invocation.pendingListings-2);return {...previous,status:{...previous.status,state:'partial' as const,detail:`新規取得の2時間間隔で待機中。次回受付 ${new Date(admission.nextAllowedAt).toISOString()}。保存済み資料を保持。`}};}
      try{
        const collected=source.parser==='tw-fisheries'?await collectTwFisheriesSource(source,previous,fetcher,admission.budget):source.parser==='tw-moa-ship'?await collectTwMoaSource(source,previous,fetcher,admission.budget):await collectTwMotcSource(source,previous,fetcher,admission.budget);
        const data=withCollectionProgress(previous,collected,now);data.revision=REVISION;await writePrivateNavSource(db,data,{id:`nav:${id}`,startedAt:now},serializeTwRecord);return data;
      }finally{admission.budget.finish();}
    }
    if(source.parser==='navarea-public'){
      const admission=await admitMaritimeCollection(db,id,'navarea',invocation||maritimeInvocationBudget(),now);
      if(!admission.admitted){if(invocation)invocation.pendingListings=Math.max(0,invocation.pendingListings-2);return {...previous,status:{...previous.status,state:'partial' as const,detail:`新規取得の2時間間隔で待機中。次回受付 ${new Date(admission.nextAllowedAt).toISOString()}。保存済み資料を保持。`}};}
      try{const collected=await collectNavareaSource(source,previous as NavareaRecord,{fetcher,budget:admission.budget,enabled:profile==='regional-29',now});const data=withCollectionProgress(previous,collected,now);data.revision=REVISION;await writePrivateNavSource(db,data,{id:`nav:${id}`,startedAt:now});return data;}finally{admission.budget.finish();}
    }
    const collected = catalog[index].parser === "jcg-navarea11" ? await collectJcgSource(catalog[index],previous,fetcher) : catalog[index].parser === "namria-navphil-json" ? await collectPhilippinesMaritime(catalog[index],previous,fetcher) : catalog[index].parser === "gicoms-html" ? await collectKoreaMaritime(catalog[index],previous,fetcher) : await collectSource(catalog[index], previous, fetcher);
    const data=withCollectionProgress(previous,collected,now);
    data.revision=REVISION;
    await db.prepare("INSERT INTO nav_sources (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").bind(id, JSON.stringify(data)).run();
    return data;
  } finally { await releaseLease(db, `nav:${id}`, now); }
}
export async function refreshNavSources(db: D1Database, fetcher: typeof fetch = fetch) {
  let cursor = 0;
  const central=navSources.filter(s=>s.regionalPageLimit===2),shift=Math.floor(Date.now()/7200000)%central.length,rotated=[...central.slice(shift),...central.slice(0,shift)];let nextCentral=0;
  const ordered=navSources.map(s=>s.regionalPageLimit===2?rotated[nextCentral++]:s),invocation=maritimeInvocationBudget(navSources.filter(guardedSource).length*2);
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < ordered.length) {
      const sourceId=ordered[cursor++].id;
      try { await refreshNavSource(db,sourceId,fetcher,false,invocation); }
      catch { console.error("Maritime refresh failed; other sources continue",sourceId); }
    }
  }));
}
