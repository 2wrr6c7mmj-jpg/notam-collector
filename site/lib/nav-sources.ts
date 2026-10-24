import type {NavCollectionProgress} from './nav-collection-progress';
import {navareaSources} from './navarea-pacific';
import {twMoaSource} from './nav-tw-moa';
import {twMotcSource} from './nav-tw-motc';
import {twMndSources} from './nav-tw-mnd';
import {koreaMaritimeSource} from "./nav-korea";
import {philippinesMaritimeSource} from "./nav-philippines";
import {twFisheriesSource} from "./nav-tw-fisheries";
import {jcgSource} from "./nav-jcg";
// Public regional columns advertised by China MSA's 航行警告 navigation,
// verified from an official Qinhuangdao article on 2026-10-02.
// Regional websites are additional publications, not mirrors or access proxies.
export type MaritimeSourceProfile = 'legacy-24'|'regional-29';
// Paired activation changes this reviewed profile; MND sources stay excluded.
export const MARITIME_SOURCE_PROFILE:MaritimeSourceProfile='regional-29';
export type NavSource = { id: string; name: string; region: string; url: string; discover?: boolean; includeNotices?: boolean; country?: string; parser?: string; regionalPageLimit?: 2 };
const registeredSources: NavSource[] = [
  jcgSource, philippinesMaritimeSource, twFisheriesSource, koreaMaritimeSource,
  { id: "ln", name: "辽宁海事局", region: "北部・遼寧", url: "https://www.msa.gov.cn/c8896863b1014c438705536a03eb46ff/index.jhtml" },
  { id: "tj", name: "天津海事局", region: "北部・天津", url: "https://www.msa.gov.cn/bdba5fad6e5d48679f970fcf8efb8636/index.jhtml" },
  { id: "hb", name: "河北海事局", region: "北部・河北", url: "https://www.msa.gov.cn/93b73989d22045f9bc3270a6eba35180/index.jhtml" },
  { id: "sd", name: "山东海事局", region: "北部・山東", url: "https://www.msa.gov.cn/36ea3354c8f84953aba082d6d989c750/index.jhtml" },
  { id: "lyg", name: "连云港海事局", region: "東部・連雲港", url: "https://www.msa.gov.cn/fa4501f3dbe44f70bc726f27132d4e04/index.jhtml" },
  { id: "js", name: "江苏海事局", region: "東部・江蘇", url: "https://www.msa.gov.cn/b5b0f3c7630d4967b1e6b06208575d15/index.jhtml" },
  { id: "sh", name: "上海海事局", region: "東部・上海", url: "https://www.msa.gov.cn/94df14ce1110415da44e67593e76619f/index.jhtml" },
  { id: "zj", name: "浙江海事局", region: "東部・浙江", url: "https://www.msa.gov.cn/8e10ea74eb9e4c9690f8f891968add80/index.jhtml" },
  { id: "fj", name: "福建海事局", region: "東部・福建", url: "https://www.msa.gov.cn/7b08405760384570a0fb44e9204c4b1d/index.jhtml" },
  { id: "gd", name: "广东海事局", region: "南部・広東", url: "https://www.msa.gov.cn/1e478d409e854918bf12478b8a19f4a8/index.jhtml" },
  { id: "sz", name: "深圳海事局", region: "南部・深圳", url: "https://www.msa.gov.cn/325fdc0892b44313a63ee5c165be98ec/index.jhtml" },
  { id: "gx", name: "广西海事局", region: "南部・広西", url: "https://www.msa.gov.cn/86de2fffff2c47f98359fd1f20d6508f/index.jhtml" },
  { id: "hn", name: "海南海事局", region: "南部・海南", url: "https://www.msa.gov.cn/d3340711057b494b8fa09eedc4c5ead9/index.jhtml" },
  { id: "cj", name: "长江海事局", region: "内陸・長江", url: "https://www.msa.gov.cn/9340423406cc4507b2fb8af2492d2a3d/index.jhtml" },
  { id: "js-local", name: "江苏省地方海事局", region: "内陸・江蘇省", url: "https://www.msa.gov.cn/d14ed012960b4064971270459a4a0d4d/index.jhtml" },
  { id: "jx-local", name: "江西省地方海事局", region: "内陸・江西省", url: "https://www.msa.gov.cn/html/cnmsa/hxaq/aqxx/hxjg/jxsdfhsju/index.html" },
  { id: "zj-web", name: "浙江海事局（地方サイト）", region: "東部・浙江", url: "https://www.zj.msa.gov.cn/ZJ/wszw/bmcx/hsskcx/hxjg/" },
  { id: "js-web", name: "江苏海事局（地方サイト）", region: "東部・江蘇", url: "https://www.js.msa.gov.cn/col/col75/index.html" },
  { id: "cj-web", name: "长江海事局（地方サイト）", region: "内陸・長江", url: "https://cj.msa.gov.cn/xxgk/xxgkml/hxtg/slhlb_2370.shtml" },
  { id: "hlj", name: "黑龙江海事局（内河通告）", region: "内陸・黒竜江", url: "https://hlj.msa.gov.cn/channel/list/43.html", includeNotices: true },
];
// Definitions are staged outside the active24-source contract.
export const stagedTaiwanSources:NavSource[]=[twMoaSource,twMotcSource,...twMndSources];
export const stagedMaritimeSources:NavSource[]=[...stagedTaiwanSources,...navareaSources];
export function getNavSources(profile:MaritimeSourceProfile=MARITIME_SOURCE_PROFILE):NavSource[]{
 const base=registeredSources.map(source=>new URL(source.url).origin==='https://www.msa.gov.cn'&&!source.parser?{...source,regionalPageLimit:2 as const}:source);
 if(profile==='legacy-24')return base;
 if(profile==='regional-29')return [...base,twMoaSource,twMotcSource,...navareaSources];
 throw Error('Unsupported maritime source profile');
}
export const navSources:NavSource[]=getNavSources();
export type SourceStatus = NavSource & {
  state: "pending" | "ok" | "partial" | "error";
  validatedAt?: number | null; checkedAt: number | null; fetchedAt: number | null; count: number;
  pages: number; detail: string; collectionProgress?: NavCollectionProgress;
};
export const navPalette = {
  firing: { label: "軍事活動・射撃・発射", color: "#ffb74d" },
  other: { label: "その他の情報", color: "#44d8cf" },
};
