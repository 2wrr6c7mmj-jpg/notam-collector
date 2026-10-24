import { decodeHtml, navWarningToNotice } from "./nav-warning";
import type { Notice } from "./notam";
import type { NavSource } from "./nav-sources";
import { warningNumber,canonicalWarningNumber } from "./nav-id";
export { warningNumber } from "./nav-id";

const firstPageMeta=(item:Notice)=>(item as Notice&{chinaFirstPage?:{entryKey:string;sourceId:string;legacyCancellationKeys?:string[]}}).chinaFirstPage;
export const warningKey = (item: Notice) => firstPageMeta(item)?`CN-FIRST-PAGE|${firstPageMeta(item)!.sourceId}|${firstPageMeta(item)!.entryKey}`:`${item.sourceCountry || "CN"}|${canonicalWarningNumber(item.id) || item.sourceUrl || item.id}`;
export const mapNoticeKey = (item: Notice) => `${item.location}|${item.id}|${item.text}`;

export function linksIn(html: string, base: string) {
  const out: { url: string; title: string }[] = [];
  for (const m of html.matchAll(/<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeHtml(m[2]), base);
      if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, "") !== new URL(base).hostname.replace(/^www\./, "")) continue;
      url.hash = "";
      const title = decodeHtml(`${m[1]} ${m[3]}`.match(/\btitle=["']([^"']+)["']/i)?.[1] || m[4]);
      if (!out.some((item) => item.url === url.href)) out.push({ url: url.href, title });
    } catch { /* Invalid public link. */ }
  }
  return out;
}
export const englishChinaWarningNumber=/\b(?:CN|CE|CS|TJ|LN|HB|SD|LYG|JS|SH|ZJ|FJ|GD|SZ|GX|HN)\s*\d+\s*\/\s*(?:\d{2}|20\d{2})\b/;
export function navListingUrl(url:string){const path=new URL(url).pathname;return path.endsWith('/')||/\/(?:index(?:_\d+)?\.(?:s?html|jhtml)|channel\/list\/\d+(?:_\d+)?\.html|slhlb_\d+(?:_\d+)?\.shtml)$/i.test(path);}
export function articleLinks(html: string, base: string, includeNotices = false) {
  return linksIn(html, base).filter(({ url, title }) =>
    (warningNumber.test(title) || englishChinaWarningNumber.test(title) || /航行警告/.test(title) || (includeNotices && (/航行通告|黑航通/.test(title) || /\/hxtg\//.test(url))) || /\/hxjg\/\d{6}\/t\d+_\d+\.html/.test(url)) &&
    !/统计|标准|发布|申请|办事|管理规定|指南|年报/.test(title) &&
    !navListingUrl(url) && url!==new URL(base).href && !/index\.(?:html|jhtml)|HangXingJingGao\.init(?!.*warnID)/i.test(url));
}
export function nextPage(html: string, base: string) {
  const links = linksIn(html, base);
  const linked = links.find(({ title, url }) => url !== new URL(base).href && /^(下一页|下页|›|>)$/.test(title.trim()))?.url;
  if (linked) return linked;
  // Numeric dataproxy links include the current and previous pages too. The
  // first link is not necessarily the next page (and may cause a crawl loop).
  const current = new URL(base), currentPage = Number(current.searchParams.get("page") || 1);
  const proxy = links.map((link) => new URL(link.url)).filter((url) =>
    /\/dataproxy\.jsp$/i.test(url.pathname) && /^\d+$/.test(url.searchParams.get("page") || "") &&
    Number(url.searchParams.get("page")) > currentPage).sort((a, b) => Number(a.searchParams.get("page")) - Number(b.searchParams.get("page")))[0];
  if (proxy) return proxy.href;
  // These public pagination templates are used by the bureaus' own scripts.
  const trs = html.match(/createPageHTML\(\s*(\d+)\s*,\s*(\d+)\s*,\s*["']([\w-]+)["']\s*,\s*["'](s?html)["']/);
  if (trs && +trs[2] + 1 < +trs[1]) return new URL(`${trs[3]}_${+trs[2] + 1}.${trs[4]}`, base).href;
  const zj = html.match(/buildNavCode\(\s*["']([\w-]+)["']\s*,\s*["'](s?html)["']\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (zj) {
    const position = +zj[3] === 0 ? 0 : +zj[4] - +zj[3];
    if (position < +zj[4] - 1) return new URL(`${zj[1]}_${+zj[4] - position - 1}.${zj[2]}`, base).href;
  }
  const curr = html.match(/pageParam\.curr\s*=\s*(\d+)/), count = html.match(/pageParam\.count\s*=\s*(\d+)/), limit = html.match(/pageParam\.limit\s*=\s*(\d+)/);
  if (curr && count && limit && +curr[1] * +limit[1] < +count[1] && /location.href\s*=\s*'index_'\s*\+\s*obj.curr\s*\+\s*'\.jhtml'/.test(html)) return new URL(`index_${+curr[1] + 1}.jhtml`, base).href;
  return null;
}
function elementBody(html: string) {
  const marked = html.match(/<!--\s*(?:正文开始|正文begin|正文内容开始|StartFragment|ZJEG_RSS.content.begin)\s*-->([\s\S]*?)<!--\s*(?:正文结束|正文end|正文内容结束|EndFragment|ZJEG_RSS.content.end)\s*-->/i)?.[1]
    || html.match(/<meta\b[^>]*name=["']ContentStart["'][^>]*>([\s\S]*?)<meta\b[^>]*name=["']ContentEnd["'][^>]*>/i)?.[1];
  if (marked) return marked;
  const preferred = html.search(/<div\b[^>]*class=["']zjy_main["'][^>]*>/i);
  if (preferred >= 0) html = html.slice(preferred);
  const start = /<(div|article)\b[^>]*(?:class|id)\s*=\s*["'](?:zjy_main|article|article-content|article_content|TRS_Editor|TRS_UEDITOR|view|Custom_UnionStyle|content|content-body|art-content|zoom|zoomcon|text|detail-content)(?:\s[^"']*)?["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = start.exec(html))) {
    const tokens = new RegExp("</?" + match[1] + "\\b[^>]*>", "gi");
    tokens.lastIndex = start.lastIndex;
    let depth = 1, token: RegExpExecArray | null;
    while ((token = tokens.exec(html))) {
      depth += /^<\//.test(token[0]) ? -1 : 1;
      if (!depth) {
        const body = html.slice(start.lastIndex, token.index);
        const plain = decodeHtml(body);
        if (warningNumber.test(plain) || plain.length > 20) return body;
        break;
      }
    }
  }
  return "";
}
function meta(html: string, name: string) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (new RegExp(`name=["']${name}["']`, "i").test(m[0])) return m[0].match(/content=["']([^"']*)["']/i)?.[1] || "";
  }
  return "";
}
export function parseNavArticle(html: string, url: string, source: NavSource): Notice | null {
  const title = decodeHtml(meta(html, "ArticleTitle") || html.match(/<div[^>]*id=["']artibodyTitle["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<div class=["']article-title["']>([\s\S]*?)<\/div>/i)?.[1] || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
  const text = decodeHtml(elementBody(html).replace(/<div\b[^>]*class=["']foot_but["'][^>]*>[\s\S]*/i, ""));
  if (!text || (!warningNumber.test(`${title}\n${text}`) && !englishChinaWarningNumber.test(`${title}\n${text}`) && !/航行警告/.test(title) && !(source.includeNotices && /航行通告|黑航通/.test(title)))) return null;
  const published = meta(html, "PubDate") || decodeHtml(html).match(/(?:发布时间|发布日期|发文日期|时间)[：:]?\s*(20\d{2}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/)?.[1] || "";
  const issuer = meta(html, "ContentSource") || decodeHtml(html).match(/发布单位[：:]\s*([^\n，,]{1,35}?海事局)/)?.[1] || decodeHtml(html).match(/来源[：:]\s*([^\n]{1,35}?海事局)/)?.[1] || source.name;
  return navWarningToNotice({ title, text, published, url, source: decodeHtml(issuer) });
}
export function legacyCancellationKeys(item:Notice):string[]{
  const cancelled = new Set<string>();
  for (const m of item.text.matchAll(/(?:撤销|取消|解除|撤除)[^。；\n]{0,18}?([\u4e00-\u9fff]{1,8}航警\s*\d+\s*\/\s*\d{2,4})/g)) cancelled.add(`${item.sourceCountry || "CN"}|${canonicalWarningNumber(m[1]) || m[1].replace(/\s/g, "")}`);
  for (const m of item.text.matchAll(/([\u4e00-\u9fff]{1,8}航警\s*\d+\s*\/\s*\d{2,4})[^。；\n]{0,12}?(?:撤销|取消|解除)/g)) cancelled.add(`${item.sourceCountry || "CN"}|${canonicalWarningNumber(m[1]) || m[1].replace(/\s/g, "")}`);
  return [...cancelled];
}
export function mergeNavItems(items: Notice[]) {
  const unique = new Map<string, Notice>();
  for (const item of items) {
    const key = warningKey(item), old = unique.get(key);
    if (!old || (item.issued || 0) > (old.issued || 0) || ((item.issued || 0) === (old.issued || 0) && item.text.length > old.text.length)) unique.set(key, item);
  }
  const cancelled = new Set<string>();
  for (const item of unique.values()) {
    // Only explicitly retained legacy lifecycle evidence carries forward.
    // Fresh first-page references never become automatic whole-notice cancellation.
    const keys=firstPageMeta(item)?firstPageMeta(item)!.legacyCancellationKeys||[]:legacyCancellationKeys(item);
    for(const key of keys)cancelled.add(key);
  }
  return [...unique.values()].map((item) => (cancelled.has(warningKey(item)) || Boolean(firstPageMeta(item)&&cancelled.has(`${item.sourceCountry || "CN"}|${canonicalWarningNumber(item.id) || item.id}`))) ? { ...item, cancelled: true, shapes: [], warnings: [...item.warnings, "取消しの警告を確認しました。"] } : item).sort((a, b) => (b.issued || 0) - (a.issued || 0));
}
