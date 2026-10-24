import type { Notice, Point, Shape } from "./notam";
import type { NavSource } from "./nav-sources";
import type { SourceRecord } from "./nav-store";

/** Live official app and payload verified 2026-10-02; no GeoServer/WFS dependency. */
export const philippinesMaritimeSource: NavSource = {
  id: "ph-namria", name: "NAMRIA NAVPHIL", region: "フィリピン", country: "PH",
  parser: "namria-navphil-json", url: "https://geoportal.gov.ph/webapi/api/layers/getNWlayers2",
};
export const philippinesMaritimeReferences = {
  app: "https://geoportal.gov.ph/gpapps/nwapp",
  payload: philippinesMaritimeSource.url,
  index: "https://namria.gov.ph/Downloads.aspx?section=notice",
  verifiedOriginal: "https://staging.geoportal.gov.ph/nwbuilder2/pdf/navphil_202_2026.pdf",
};
type Layer = { layer_name: string; title: string; description: string };
const MONTHS: Record<string, number> = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUNE:6,JUL:7,JULY:7,AUG:8,SEP:9,SEPT:9,OCT:10,NOV:11,DEC:12 };
const MONTH = "(?:JAN|FEB|MAR|APR|MAY|JUNE?|JULY?|AUG|SEPT?|OCT|NOV|DEC)";
const normalized = (s:string) => s.toUpperCase().replace(/\s+/g," ").trim();
function stamp(digits:string,month:string,year:string):number|null {
  const d=+digits.slice(0,2), h=+digits.slice(2,4), m=+digits.slice(4,6), mo=MONTHS[month];
  if (!mo || digits.length!==6 || h>23 || m>59) return null;
  const t=Date.UTC(+year,mo-1,d,h,m), dt=new Date(t);
  return dt.getUTCFullYear()===+year && dt.getUTCMonth()===mo-1 && dt.getUTCDate()===d ? t : null;
}
export function navphilTiming(text:string) {
  const t=normalized(text), periods:{start:number;end:number}[]=[];
  // A date or coordinate must never be mistaken for DDHHMM; require UTC explicitly.
  const full = new RegExp(`\\b(\\d{6}) UTC (${MONTH}) (20\\d{2}) TO (\\d{6}) UTC (${MONTH})(?: (20\\d{2}))?\\b`,"g");
  const short = new RegExp(`\\b(\\d{6}) TO (\\d{6}) UTC (${MONTH}) (20\\d{2})\\b`,"g");
  const unsupported = /\b(?:DAILY|EXCEPT|MONDAYS?|TUESDAYS?|WEDNESDAYS?|THURSDAYS?|FRIDAYS?|SATURDAYS?|SUNDAYS?|INTERMITTENT|PERIODIC)\b/.test(t);
  if (!unsupported) {
    for (const m of t.matchAll(full)) {
      const s=stamp(m[1],m[2],m[3]), e=stamp(m[4],m[5],m[6]||m[3]);
      if (s!==null && e!==null && e>=s) periods.push({start:s,end:e});
    }
    for (const m of t.matchAll(short)) {
      const s=stamp(m[1],m[3],m[4]), e=stamp(m[2],m[3],m[4]);
      if (s!==null && e!==null && e>=s) periods.push({start:s,end:e});
    }
  }
  const until=t.match(new RegExp(`\\bUNTIL (\\d{6}) UTC (${MONTH}) (20\\d{2})\\b`));
  const cancel=t.match(new RegExp(`\\bCANCEL THIS (?:MSG|MESSAGE|NAVIGATIONAL WARNING)(?: ON)? (\\d{6}) UTC (${MONTH}) (20\\d{2})\\b`));
  const end=until ? stamp(until[1],until[2],until[3]) : null;
  const cancelsAt=cancel ? stamp(cancel[1],cancel[2],cancel[3]) : null;
  // IN PROGRESS supplies no issue/start timestamp. Preserve known end but do not invent start.
  const start=periods.length ? Math.min(...periods.map(p=>p.start)) : null;
  const stop=periods.length ? Math.max(...periods.map(p=>p.end)) : end;
  return { start, end:stop, periods, cancelsAt, timeUncertain:unsupported || !periods.length };
}
function points(text:string):Point[] {
  const result:Point[]=[];
  const re=/(?<!\d)(\d{1,2})\s*[- ]\s*(\d{1,2}(?:\.\d+)?)\s*N\s*[,;]?\s*(\d{2,3})\s*[- ]\s*(\d{1,2}(?:\.\d+)?)\s*E\b/g;
  for(const m of normalized(text).matchAll(re)) {
    const lat=+m[1]+ +m[2]/60, lon=+m[3]+ +m[4]/60;
    if(+m[2]>=60 || +m[4]>=60 || lat>90 || lon>180) continue;
    // Project's Point is [latitude, longitude].
    result.push([lat,lon]);
  }
  return result;
}
export function navphilShapes(text:string):Shape[] {
  const t=normalized(text), all=points(t);
  if(!all.length) return [];
  if(/\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS)\b/.test(t)) return all.map(point=>({kind:"point",points:[point],provenance:"text"}));
  const radius=t.match(/\bRADIUS (THREE|\d+(?:\.\d+)?) NAUTICAL MILES?\b/);
  if(radius && all.length===1) return [{kind:"circle",points:all,radius:(radius[1]==="THREE"?3:+radius[1])*1852,provenance:"text"}];
  const bounded=/\bAREAS? (?:BOUND|BOUNDED) BY\b/.test(t);
  const lines=/\bALONG LINES? JOINING\b/.test(t);
  if(bounded || lines) {
    // Separate repeated areas/lines before collecting points. Never connect two areas.
    const directive=bounded ? /\bAREAS? (?:BOUND|BOUNDED) BY\s*:?/g : /\bALONG LINES? JOINING\s*:?/g;
    const sections=t.split(directive).slice(1);
    return sections.flatMap<Shape>(section=>{
      const labeled=section.split(/(?:^|\s)[A-Z]\.\s*(?=\d{1,2}[- ])/).filter(s=>points(s).length);
      const minimum=bounded?3:2;
      // Lettered groups with several points are separate geometries. A,B,C vertex labels
      // on single coordinates are one boundary, not three small polygons.
      const groups=labeled.length>1 && labeled.some(s=>points(s).length>1) ? labeled : [section];
      return groups.flatMap<Shape>(group=>{
        const p=points(group);
        if(p.length<minimum) return p.map(point=>({kind:"point" as const,points:[point],provenance:"text" as const}));
        const path=bounded && (p[0][0]!==p[p.length-1][0] || p[0][1]!==p[p.length-1][1]) ? [...p,p[0]] : p;
        return [{kind:bounded?"polygon" as const:"line" as const,points:path,provenance:"text" as const}];
      });
    });
  }
  // Multiple lights/vicinity positions are distinct points, never a made-up polygon.
  return all.map(point=>({kind:"point",points:[point],provenance:"text"}));
}
function identity(text:string) {
  const m=text.match(/NAVPHIL\s+(\d+)\/(\d{2}|20\d{2})\b/i);
  return m ? `NAVPHIL-${m[2].length===2?`20${m[2]}`:m[2]}-${+m[1]}` : null;
}
function cancels(text:string) {
  const out:string[]=[];
  for(const clause of text.matchAll(/\bCANCEL\s+NAVPHILS?\s+([^\r\n.]*)/gi)) {
    for(const m of clause[1].matchAll(/(\d+)\/(\d{2}|20\d{2})\b/g)) out.push(`NAVPHIL-${m[2].length===2?`20${m[2]}`:m[2]}-${+m[1]}`);
  }
  return out;
}
export function parseNavphilLayer(layer:Layer,source:NavSource=philippinesMaritimeSource,now=Date.now()):Notice|null {
  if(!/^navphil_\d+_(?:\d{2}|20\d{2})$/.test(layer.layer_name)) return null;
  const id=identity(layer.description); if(!id) return null;
  const time=navphilTiming(layer.description), shapes=navphilShapes(layer.description);
  const warnings=["公式一覧には失効・取消済み情報が残る場合があります。原文を確認してください。"];
  if(/\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS)\b/i.test(layer.description)) warnings.push("除外条件を含むため区域は未確定です。座標のみ表示します。");
  if(time.timeUncertain) warnings.push("開始時刻・時区・実施時間帯の一部が不明です。未確認時間を連続した有効期間として扱いません。");
  if(!shapes.length) warnings.push("座標を安全に読み取れません。原文を確認してください。");
  if(shapes.length) warnings.push("形状は原文座標から生成。原文に測地系の明記はありません。");
  const cancelled=time.cancelsAt!==null && time.cancelsAt<=now;
  return {id,location:layer.title,text:layer.description,issued:null,start:time.start,end:time.end,permanent:false,
    purpose:/\b(?:FIRING|MILITARY|EXERCISES?|SPACE DEBRIS|ROCKET|MISSILE)\b/i.test(layer.description)?"firing":"other",
    shapes:cancelled?[]:shapes,warnings,sourceUrl:`https://staging.geoportal.gov.ph/nwbuilder2/pdf/${layer.layer_name}.pdf`,
    sourceName:source.name,sourceCountry:"PH",regions:["PH"],validityPeriods:time.periods,timeUncertain:time.timeUncertain,cancelled};
}
export async function collectPhilippinesMaritime(source:NavSource,previous:SourceRecord,fetcher:typeof fetch=fetch):Promise<SourceRecord> {
  const now=Date.now();
  try {
    const response=await fetcher(source.url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000),redirect:"follow"});
    if(!response.ok) throw new Error(`公式 JSON HTTP ${response.status}`);
    if(response.url && new URL(response.url).hostname!=="geoportal.gov.ph") throw new Error("想定外の転送先");
    const raw=await response.text(); if(raw.length>2000000) throw new Error("応答サイズ上限");
    const data=JSON.parse(raw) as {children?:unknown[]};
    if(!Array.isArray(data.children) || !data.children.length) throw new Error("警告本文一覧を確認できません（0件とは断定できません）");
    const items:Notice[]=[], canceled=new Set<string>(); let skipped=0;
    for(const value of data.children) {
      if(!value || typeof value!=="object") {skipped++;continue;}
      const l=value as Partial<Layer>;
      if(typeof l.layer_name!=="string" || typeof l.title!=="string" || typeof l.description!=="string") {skipped++;continue;}
      const item=parseNavphilLayer(l as Layer,source,now);
      if(!item) {skipped++;continue;} items.push(item);
      for(const id of cancels(l.description)) canceled.add(id);
    }
    if(!items.length) throw new Error("本文を読み取れません（0件とは断定できません）");
    // A new warning can cancel another still present in this stale active-list endpoint.
    for(const item of items) if(canceled.has(item.id)) { item.cancelled=true;item.shapes=[];item.warnings.push("後続 NAVPHIL の明示取消対象です。"); }
    const uncertain=items.filter(i=>i.timeUncertain&&!i.cancelled).length;
    return {items,revision:1,listingUrl:source.url,status:{...source,state:"partial",checkedAt:now,fetchedAt:now,count:items.length,pages:1,
      detail:`公式 JSON 本文 ${items.length}件。${skipped?`未解析 ${skipped}件。`:""}日時の一部未確定 ${uncertain}件。公式掲載件数は有効件数と異なります。取消・全件網羅は原文確認が必要。`}};
  } catch(error) {
    return {...previous,status:{...source,state:"error",checkedAt:now,fetchedAt:previous.status.fetchedAt,count:previous.items.length,pages:0,
      detail:`取得不可（0件ではありません）。${error instanceof Error?error.message:"不明なエラー"}。前回取得データを保持。`}};
  }
}
