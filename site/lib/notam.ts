import {parseExplicitCorridor} from "./notam-corridor";
import {parseExplicitTrueBearingSector, normalizePositiveDecimalEastPair, hasConflictingRadiusUnits, splitExplicitBalloonAltitudeAreas} from "./notam-japan-geometry";
import {normalizeCoordinatePunctuation} from "./notam-coordinate-punctuation";
import {applyPublishedExclusion} from "./notam-exclusion-reference";
import {parseExplicitArcBoundary,hasGeometricArcText} from "./notam-arcs";
import { koreaAirspaceDefinitions } from "./korea-airspaces.generated";
import { philippinesAirspaceDefinitions } from "./philippines-airspaces";
import { russiaAirspaceDefinitions } from "./russia-airspaces";

export const codes =
  "ZYSH,ZBPE,ZSHA,ZGZU,ZPKM,ZHWH,ZLHW,ZWUQ,ZJSA,RJJJ,RCAA,RKRR,ZKKP,RPHI,UHHH,UHMM,UEEE,UIII,RJSM,RJCJ,RJTY,RJTA,RJOI,RODN,ROTM,RCPO,RCMQ,RCKU,RCSQ,RKSO,RKJK,RKSG,RPLC,RPLB,RPVP,RPVM,ZKPY,UHWW,UHSS,UHPP,ROAH,RJAH,RJST,RKTI,RKTU,RCNN,RCDC,RPLS,RPMZ,RPML,RJTJ,RJNG,RJNK,RKSW,RKTP,RKTY,RCSS,RCQS,UHMA,ZKWS,RJNH,RJFY,RJFN,RJFZ,RJFA,RJOH,RJNA,RKSM,RKPE,RKTE,RKTN,RKNN,RCYU,RCAY,RCQC,RPMD,RPUT,RPUY,RPVI,RPMC,RJTL,RJTK,RJTE,RJSH,RJAW,RJCA,RJCT,RJDM,RKPK,RKTH,RKPS,RKJJ,RKNW,RCXY,RCDI,RCMJ,RCRA,RPMJ,RPMY,UIAA".split(
    ",",
  );
export const purposes = {
  hazard: { label: "閉鎖・制限・危険情報", color: "#ff626d" },
  firing: { label: "射撃や発射", color: "#ffb74d" },
  training: { label: "訓練・演習", color: "#44d8cf" },
  drone: { label: "ドローンなどの無人航空機", color: "#b6a0ff" },
  other: { label: "その他の情報", color: "#9bb4c9" },
};
export type Purpose = keyof typeof purposes;
export type Point = [number, number];
export type Shape = {
  kind: "polygon" | "line" | "point" | "circle";
  points: Point[];
  radius?: number;
  approx?: boolean;
  inferredClose?: boolean;
  provenance?: "provider" | "text" | "named";
  holes?: Point[][];
  interpolated?: boolean;
  /** Known outer edges only; exclusions or other boundary portions remain unresolved. */
  partialBoundary?: boolean;
  referenceBoundary?: boolean;
  sourceReference?: string;
  sourceRow?: string;
  validityPeriods?: {start:number;end:number}[];
  corridorHalfWidthMeters?: number;
  reconstructedCorridor?: boolean;
  coastlineApproximated?: boolean;
};
export type Notice = {
  id: string;
  location: string;
  text: string;
  issued: number | null;
  start: number | null;
  end: number | null;
  permanent: boolean;
  purpose: Purpose;
  shapes: Shape[];
  warnings: string[];
  sourceUrl?: string;
  sourceName?: string;
  sourceCountry?: string;
  regions?: string[];
  validityPeriods?: {start:number;end:number;precision?:"date"|"mixed";startPrecision?:"date"|"time";endPrecision?:"date"|"time";scopeLabel?:string}[];
  timeUncertain?: boolean;
  maritimeTimeBasis?: {zone:string;disclosure:string;sourceUrl:string;sourceDate?:string;reviewRequired?:boolean};
  maritimeAttachment?: {status:"unattempted"|"unsupported"|"fetch-error"|"fulltext-retained";format?:"odt"|"pdf"|"other";sourceUrl?:string;checkedAt?:number;bodyFetchedAt?:number;detail?:string;textTruncated?:boolean};
  lifecycleUncertain?: boolean;
  cancelled?: boolean;
};

const MAX_RADIUS_NM = 900;
const PATH_CONTEXT =
  /BOUNDED\s+BY|BOUNDARY|(^|[^A-Z])AREA([^A-Z]|$)|AREA\s+AS\s+FLW|WI(?:THIN)?\s+AREA|TAKE\s+PLACE\s+WI|RESTRICTED\s+ARE?A?\s+WI|DEFINED\s+AS|LINE\s+JOINING|JOINING\s+(?:THE\s+)?POINTS|EITHER\s+SIDE|POLYGON|(^|[^A-Z])(ZONE|SECTOR)([^A-Z]|$)|TO\s+(?:THE\s+)?BEGINNING|POINT\s+OF\s+ORIGIN|BACK\s+TO\s+START/i;
const EXPLICIT_CLOSE =
  /TO\s+(?:THE\s+)?(?:POINT\s+OF\s+ORIGIN|BEGINNING)|TO\s+POINT\s+OF\s+ORIGIN|BACK\s+TO\s+START|RETURN(?:ING)?\s+TO\s+START/i;

function checkedUTC(year: number, month: number, day: number, hour: number, minute: number) {
  const value = Date.UTC(year, month - 1, day, hour, minute);
  const d = new Date(value);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    && d.getUTCHours() === hour && d.getUTCMinutes() === minute ? value : null;
}
export function dateUTC(v: string): number | null {
  if (!v) return null;
  v = v.trim();
  if (/^\d{5}(?:\.\d+)?$/.test(v)) return Math.round((+v - 25569) * 86400000);
  const onlyDay = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(onlyDay){const ts=Date.UTC(+onlyDay[1],+onlyDay[2]-1,+onlyDay[3]);const dt=new Date(ts);return dt.getUTCFullYear()===+onlyDay[1]&&dt.getUTCMonth()===+onlyDay[2]-1&&dt.getUTCDate()===+onlyDay[3]?ts:null;}
  let m = v.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (m) return checkedUTC(2000 + +m[1], +m[2], +m[3], +m[4], +m[5]);
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):?(\d{2})(?:\s+UTC)?$/);
  if (m) return checkedUTC(+m[3], +m[1], +m[2], +m[4], +m[5]);
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|\s+UTC|[+-]\d{2}:\d{2})?$/i);
  if (m) {
    if (checkedUTC(+m[1], +m[2], +m[3], +m[4], +m[5]) === null || +(m[6] || 0) > 59) return null;
    const iso = v.replace(' ', 'T').replace(/\s+UTC$/i, 'Z');
    const result = Date.parse(iso + (m[7] ? '' : 'Z'));
    return Number.isFinite(result) ? result : null;
  }
  const t = Date.parse(v.replace(/\s+UTC$/i, 'Z'));
  return Number.isFinite(t) ? t : null;
}

function same(a: Point, b: Point) {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}
function pushPoint(out: Point[], p: Point) {
  if (!out.length || !same(out[out.length - 1], p)) out.push(p);
}
function parseAngle(raw: string, lat: boolean, hemisphere?: string) {
  const s = raw.trim(),
    degLen = lat ? 2 : 3,
    dot = s.indexOf("."),
    intLen = dot >= 0 ? dot : s.length;
  let value: number;
  if (dot >= 0 && intLen <= degLen) value = Number(s);
  else {
    if (intLen < degLen) return NaN;
    let deg = Number(s.slice(0, degLen)),
      min = 0,
      sec = 0;
    if (intLen <= degLen + 2) min = Number(s.slice(degLen) || 0);
    else {
      min = Number(s.slice(degLen, degLen + 2));
      sec = Number(s.slice(degLen + 2) || 0);
    }
    if (min < 0 || min >= 60 || sec < 0 || sec >= 60) return NaN;
    value = deg + min / 60 + sec / 3600;
  }
  if (!Number.isFinite(value) || value > (lat ? 90 : 180)) return NaN;
  return /[SW]/.test(hemisphere || "") ? -value : value;
}

/** Normalize only explicit coordinate notation. Horizontal whitespace and token
 * boundaries prevent N/E suffixes from swallowing later table cells or headings. */
export function normalizeCoordinateText(input: string) {
  let t = normalizeCoordinatePunctuation(normalizePositiveDecimalEastPair(input.toUpperCase())).toUpperCase()
    .replace(/&#(?:0*176|X0*B0);|&DEG;/gi, "°")
    .replace(/&#(?:0*8242|X0*2032);|&PRIME;|&APOS;|&#0*39;/gi, "'")
    .replace(/&#(?:0*8243|X0*2033);|&QUOT;|&#0*34;/gi, '"')
    .replace(/[º]/g, "°").replace(/[′’\u0092]/g, "'").replace(/[″“”]/g, '"')
    .replace(/，/g, ",").replace(/[–—]/g, "-")
    .replace(/\b(AT|PSN)(?=\d{1,3}°)/g, "$1 ");
  const marked = (d: string, m: string, s: string | undefined, h: string) => {
    const width = /[NS]/.test(h) ? 2 : 3;
    // Do not guess overflow, omitted degrees, or contradictory unit precision.
    if (+d > (width === 2 ? 90 : 180) || +m >= 60 || (s !== undefined && (+s >= 60 || m.includes('.')))) return " INVALIDCOORD ";
    return d.padStart(width, "0") + m.padStart(2 + (m.includes('.') ? m.length - m.indexOf('.') : 0), "0")
      + (s === undefined ? "" : s.padStart(2 + (s.includes('.') ? s.length - s.indexOf('.') : 0), "0")) + h;
  };
  // Interpret degree/minute/second markers before stripping them: 37°5'7.1N
  // must be 370507.1N, never 3757.1N (which means decimal minutes).
  t = t.replace(/(?<![A-Z0-9.])(\d{1,3})°[ \t]*(\d{1,2}(?:\.\d+)?)'[ \t]*(?:(\d{1,2}(?:\.\d+)?)[ \t]*"?[ \t]*)?([NSEW])(?![A-Z])/g,
    (_,d,m,s,h) => marked(d,m,s,h) + " ");
  t = t.replace(/(?<![A-Z0-9.])([NSEW])[ \t]*(\d{1,3})°[ \t]*(\d{1,2}(?:\.\d+)?)'[ \t]*(?:(\d{1,2}(?:\.\d+)?)[ \t]*"?[ \t]*)?/g,
    (_,h,d,m,s) => marked(d,m,s,h) + " ");
  // Explicit minute/second notation with missing degrees is incomplete, not a
  // decimal-degree number. Keep a sentinel for coordinateWarnings to report.
  t = t.replace(/(?<![\d.])(\d{1,2}(?:\.\d+)?)'[ \t]*(?:(\d{1,2}(?:\.\d+)?)[ \t]*"?[ \t]*)?([NSEW])(?![A-Z])/g, " INVALIDCOORD ");
  t = t.replace(/[°'\"]/g, "").replace(/:/g, " ")
    .replace(/\b(AT|PSN)(?=\d{4,7}(?:\.\d+)?[NS])/g, "$1 ")
    .replace(/(^[ \t]*[A-Z])\.(?=\d{4,7}(?:\.\d+)?[NS])/gm, "$1) ")
    .replace(/(^[ \t]*\d{1,3})\.(?=[NSEW][ \t]*\d)/gm, "$1) ")
    .replace(/(\d{4,7})\.[ \t]+(\d+[NSEW])/g, "$1.$2");
  // Only join demonstrably wrapped digits within one compact component.
  t = t.replace(/(?<![A-Z0-9.])([NS])(\d{1,5})\r?\n[ \t]*(\d{1,5})(?=[EW]|[\s,;/.-]|$)/g,
      (all,h,a,b) => [4,6].includes(a.length+b.length) ? h+a+b : all)
    .replace(/(?<![A-Z0-9.])([EW])(\d{1,6})\r?\n[ \t]*(\d{1,6})(?=[NS]|[\s,;/.-]|$)/g,
      (all,h,a,b) => [5,7].includes(a.length+b.length) ? h+a+b : all)
    .replace(/(\d)\r?\n[ \t]*(\d{1,5}[NS])/g, "$1$2")
    .replace(/(\d)\r?\n[ \t]*(\d{1,6}[EW])/g, "$1$2");
  t = t.replace(/(\d{2,6}(?:\.\d+)?)[ \t]*NORTH/g, "$1N")
    .replace(/(\d{2,6}(?:\.\d+)?)[ \t]*SOUTH/g, "$1S")
    .replace(/(\d{3,7}(?:\.\d+)?)[ \t]*EAST/g, "$1E")
    .replace(/(\d{3,7}(?:\.\d+)?)[ \t]*WEST/g, "$1W")
    .replace(/\bNORTH[ \t]*(\d)/g, "N$1").replace(/\bSOUTH[ \t]*(\d)/g, "S$1")
    .replace(/\bEAST[ \t]*(\d)/g, "E$1").replace(/\bWEST[ \t]*(\d)/g, "W$1");
  t = t.replace(/(?<![A-Z0-9.])([NS])[ \t]*(\d{1,2})[ \t]+(\d{2})[ \t]+(\d{2}(?:\.\d+)?)/g, "$2$3$4$1")
    .replace(/(?<![A-Z0-9.])([EW])[ \t]*(\d{1,3})[ \t]+(\d{2})[ \t]+(\d{2}(?:\.\d+)?)/g, "$2$3$4$1")
    .replace(/(?<![\d.])(\d{1,2})[ \t]+(\d{2})[ \t]+(\d{2}(?:\.\d+)?)[ \t]*([NS])/g, "$1$2$3$4")
    .replace(/(?<![\d.])(\d{1,3})[ \t]+(\d{2})[ \t]+(\d{2}(?:\.\d+)?)[ \t]*([EW])/g, "$1$2$3$4");
  t = t.replace(/(?<![A-Z0-9.])([NS])[ \t]*(\d{1,2})[ \t]+(\d{2}\.\d+)/g, "$2$3$1")
    .replace(/(?<![A-Z0-9.])([EW])[ \t]*(\d{1,3})[ \t]+(\d{2}\.\d+)/g, "$2$3$1")
    .replace(/(?<![\d.])(\d{1,2})[ \t]+(\d{2}\.\d+)[ \t]*([NS])/g, "$1$2$3")
    .replace(/(?<![\d.])(\d{1,3})[ \t]+(\d{2}\.\d+)[ \t]*([EW])/g, "$1$2$3");
  t = t.replace(/(\d{1,2})-(\d{2}(?:\.\d+)?)([NS])/g, "$1$2$3")
    .replace(/(\d{1,3})-(\d{2}(?:\.\d+)?)([EW])/g, "$1$2$3");
  t = t.replace(/(^|[\s,(;/=-])([NS])[ \t]*(\d{1,6}(?:\.\d+)?)[ \t]*([EW])[ \t]*(\d{1,7}(?:\.\d+)?)/gm, "$1$3$2 $5$4")
    .replace(/(^|[\s,(;/=-])([EW])[ \t]*(\d{1,7}(?:\.\d+)?)[ \t]*([NS])[ \t]*(\d{1,6}(?:\.\d+)?)/gm, "$1$5$4 $3$2")
    .replace(/(^|[\s,(;/=-])([NS])[ \t]*(\d{4}(?:\d{2})?(?:\.\d+)?)(?![\d.])/gm, "$1$3$2")
    .replace(/(^|[\s,(;/=-])([EW])[ \t]*(\d{5}(?:\d{2})?(?:\.\d+)?)(?![\d.])/gm, "$1$3$2");
  t = t.replace(/(\d)[ \t]+([NSEW])(?=[\s,;/.()-]|$)/g, "$1$2");
  // Published fixed-width COORD tables place longitude on the next row while
  // unrelated altitude/aircraft columns follow latitude. Pair only same-count,
  // aligned columns, with a longitude-only continuation row.
  if (/\bCOORD(?:INATES)?\b/.test(t)) {
    const lines = t.split(/\r?\n/);
    for (let i=0;i<lines.length-1;i++) {
      const lats=[...lines[i].matchAll(/(?<![\d.])\d{6}(?:\.\d+)?[NS](?![A-Z])/g)];
      const lons=[...lines[i+1].matchAll(/(?<![\d.])\d{7}(?:\.\d+)?[EW](?![A-Z])/g)];
      if (!lats.length || lats.length!==lons.length || /\d[EW]\b/.test(lines[i])
        || lines[i+1].replace(/\d{7}(?:\.\d+)?[EW]/g, '').trim()
        || !lats.every((m,j)=>Math.abs(m.index!-lons[j].index!)<=3)) continue;
      for(let j=lats.length-1;j>=0;j--) {
        const m=lats[j];lines[i]=lines[i].slice(0,m.index!)+m[0]+" "+lons[j][0]+lines[i].slice(m.index!+m[0].length);
      }
      lines[i+1]=lines[i+1].replace(/\d{7}(?:\.\d+)?[EW]/g,'');i++;
    }
    t=lines.join('\n');
  }
  return t.replace(/NAUTICAL\s+MILES?/g, "NM").replace(/KILOMET(?:RE|ER)S?/g, "KM")
    .replace(/MET(?:RE|ER)S?/g, "M").replace(/A\s+CIRCLE\s+RADIUS/g, "CIRCLE RADIUS")
    .replace(/CIRCLE\s+OF\s+RADIUS/g, "RADIUS")
    .replace(/CIRCLE\s+OF\s+(\d+(?:\.\d+)?)\s*(KM|NM|M|FT)\s+RADIUS/g, "RADIUS $1 $2");
}

export function coordinates(text: string): Point[] {
  const t = normalizeCoordinateText(text);
  const hits: { i: number; p: Point }[] = [];
  const pair =
    /(?<![A-Z0-9.])(?:(\d{1,6}(?:\.\d+)?)([NS])\s*[- /,;]*\s*(\d{1,7}(?:\.\d+)?)([EW])|(\d{1,7}(?:\.\d+)?)([EW])\s*[- /,;]*\s*(\d{1,6}(?:\.\d+)?)([NS]))(?![A-Z0-9])/g;
  for (const m of t.matchAll(pair)) {
    const lat = m[1]
      ? parseAngle(m[1], true, m[2])
      : parseAngle(m[7], true, m[8]);
    const lon = m[3]
      ? parseAngle(m[3], false, m[4])
      : parseAngle(m[5], false, m[6]);
    if (Number.isFinite(lat) && Number.isFinite(lon))
      hits.push({ i: m.index || 0, p: [lat, lon] });
  }
  const decimal =
    /(?<![\d.])(?:LAT(?:ITUDE)?\s*=?\s*)?([-+]?\d{1,2}\.\d+)(?:\s*[,;/]\s*|\s+)(?:LON(?:GITUDE)?\s*=?\s*)?([-+]?\d{1,3}\.\d+)(?!\d|\.\d)|LAT(?:ITUDE)?\s*=?\s*([-+]?\d{1,2}\.\d+)[\s,;/]+LON(?:GITUDE)?\s*=?\s*([-+]?\d{1,3}\.\d+)(?!\d|\.\d)|LON(?:GITUDE)?\s*=?\s*([-+]?\d{1,3}\.\d+)[\s,;/]+LAT(?:ITUDE)?\s*=?\s*([-+]?\d{1,2}\.\d+)(?!\d|\.\d)/g;
  for (const m of t.matchAll(decimal)) {
    const lat = Number(m[1] || m[3] || m[6]),
      lon = Number(m[2] || m[4] || m[5]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      hits.push({ i: m.index || 0, p: [lat, lon] });
  }
  hits.sort((a, b) => a.i - b.i);
  const out: Point[] = [];
  for (const h of hits) pushPoint(out, h.p);
  return out;
}

export function distance(a: Point, b: Point) {
  const r = Math.PI / 180;
  const x =
    Math.sin(((a[0] - b[0]) * r) / 2) ** 2 +
    Math.cos(a[0] * r) *
      Math.cos(b[0] * r) *
      Math.sin(((a[1] - b[1]) * r) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, x)));
}
export function sanitizePoints(source: Point[], warnings?: string[]) {
  const clean: Point[] = [];
  for (const p of source)
    if (Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) pushPoint(clean, p);
  const closed = clean.length > 1 && same(clean[0], clean[clean.length - 1]);
  const unique = closed ? clean.slice(0, -1) : clean.slice();
  if (unique.length >= 4) {
    const nearest = unique.map((p, i) =>
      Math.min(...unique.filter((_, j) => j !== i).map((q) => distance(p, q))),
    );
    const outliers = nearest.map((d, i) => ({ d, i })).filter((x) => x.d > 900);
    if (outliers.length === 1) {
      const index = outliers[0].i;
      void index;
      warnings?.push("900 NMを超えて単独で離れた座標があります。原文の値を保持して表示しています。誤記の可能性は原文で確認してください。");
    }
  }
  return clean;
}
export function hasPathContext(text: string) {
  return PATH_CONTEXT.test(text);
}

function geometryGroups(body: string) {
  const t = normalizeCoordinateText(body).replace(
    /END\s+PART\s+\d+\s+OF\s+\d+[\s\S]*?E\)\s*/g,
    " ",
  );
  // Explicit obstacle operating areas describe footprints, not independent
  // equipment positions. Support source AERA typo only in this scoped clause.
  // Preserve the published vertex order; the normal self-intersection guard
  // decides whether closure is usable. Never apply this to bare AT COORD lists.
  if (/\bOPR\s+A(?:RE|ER)A\b/.test(t)) {
    const scope = t.split(/\bOPR\s+A(?:RE|ER)A\b/)[1]
      .split(/\n\s*\d+[.)]\s*(?:MAX\s+HGT|RMK|RED\s+OBST)\b/)[0];
    const parts = scope.split(/\n\s*(?:A(?:RE|ER)A\s+(?:[A-Z]|\d+)|TUNNELLING\s+CONSTRUCTION\(TC\)\s+AREA)\s*(?=\n)/)
      .filter(part => coordinates(part).length > 0);
    if (parts.length && parts.every(part => coordinates(part).length >= 3
      && !/\b(?:RADIUS|RAD|PSN|POSITION|EXC|EXCLUDING)\b/.test(part)))
      return parts.map(part => "AREA BOUNDED BY " + part);
  }
  // Numbered lateral limits of an explicitly established TMA are independent
  // altitude-layer rings. Require every section to repeat its own first vertex.
  if (/\bTMA\s+ESTABLISHED\b/.test(t) && /\bLATERAL\s+LIMITS\b/.test(t)
      && !/\b(?:REMOVE|DELETE|WITHDRAW)\b/.test(t)) {
    const sections=t.split(/\n[ \t]*\d+[.)][ \t]*(?=\d{4,6}(?:\.\d+)?[NS])/);
    if (sections.length>1 && sections.slice(1).every(section=>{
      const points=coordinates(section);
      return points.length>=4 && same(points[0],points[points.length-1]);
    })) return [sections[0], ...sections.slice(1).map(section=>"AREA BOUNDED BY " + section)];
  }
  return t
    // A remark coordinate is not an extra vertex of the preceding area.
    .replace(/\n[ \t]*(RMK\b)/g, (match, label, offset) => hasPathContext(t.slice(0, offset)) ? "\n|||" + label : match)
    // Semantic section headers are boundaries even when a provider flattened
    // multipart F/G fields and the next numbered corridor onto one line.
    .replace(/(^|\s)(\d+[.)]\s*WI(?:THIN)?\s+\d+(?:\.\d+)?\s*(?:KM|NM|M)\s+EITHER\s+SIDE\b)/g, "$1|||$2")
    // Explicit debris-zone labels each introduce an independent area.
    .replace(/\n[ \t]*((?:\d+(?:ST|ND|RD|TH)\s+STAGE|PAYLOAD\s+FAIRING)\b)/g, "\n|||AREA: $1")
    // Keep release positions separate from the separately labelled blocked areas.
    // Retain unclosed blocked areas as lines; this does not invent a final edge.
    .replace(/\b(RELEASE\s+POINT\s*\(\d+\))/g, "|||$1")
    .replace(/\b(BLOCKED\s+AREA)\b/g, "|||$1")
    .replace(
      /\n\s*\(?\d+\)?[.):]?\s*(AIRSPACE|AREA|ZONE|SECTOR|PLACE|PSN|CIRCLE|RADIUS|BOUNDED|WI(?:THIN)?|\d+(?:\.\d+)?\s*(?:KM|NM)\s+EITHER)(?=[^A-Z0-9]|$)/g,
      "\n|||$1",
    )
    .replace(
      /\n\s*(AIRSPACE|AREA|ZONE|SECTOR)\s+(?:\d+|[A-Z])(?:[.):]|\s|$)\s*/g,
      "\n|||$1 ",
    )
    .replace(
      /(AIRSPACE|AREA|ZONE|SECTOR)\s+\d+\s+(DEFINED\s+AS|BOUNDED\s+BY)/g,
      "|||$1 $2",
    )
    .replace(/\n\s*(TUNNELLING CONSTRUCTION\(TC\) AREA)(?=\s*\n)/g, "\n|||$1")
    .replace(/\n\s*(\d+[.)]\s*(?:FLT ALT|MAX HGT|FLT TIME|BEAMS|COLOR|POWER|CHARACTERISTICS|WX COND)\b)/g, "\n|||$1")
    .replace(/\n([ \t]*[A-Z][.)][^\n]*\bRADIUS[^\n]*)/g, "\n|||$1")
    .replace(/\n[ \t]*\d+[.)][ \t]*((?:EXP[ \t]+)?FLT[ \t]+AREA|RELEASING[ \t]+POINTS?)(?=[^A-Z]|$)/g, "\n|||$1")
    .split("|||")
    .flatMap(block => {
      // Bare numbered coordinate rings inherit only their own bounded-area
      // preamble. Numbered launch positions remain independent points.
      const parts=block.split(/\n[ \t]*\(\d+\)[ \t]*(?=\d{4,6}(?:\.\d+)?[NS])/);
      if(parts.length<2 || !/\bBOUNDED\s+BY\b/.test(parts[0])) return [block];
      const independentRings=parts.slice(1).every(part=>{
        const points=coordinates(part);
        return points.length>=4 && same(points[0],points[points.length-1]);
      });
      if(!independentRings) return [block];
      return [parts[0],...parts.slice(1).map(part => "BOUNDED BY " + part)];
    });
}
function classify(t: string): Purpose {
  if (/\bBALLOONS?\b|\/QWL[A-Z]{2}\//.test(t)) return "other";
  if (
    /DANGER|\bDGR\b|\b(?:CLSD|CLOSED)\b|(?:RESTRICTED|PROHIBITED)\s+(?:AREA|AIRSPACE|ZONE)|(?:AREA|AIRSPACE|ZONE)\s+(?:IS\s+)?(?:RESTRICTED|PROHIBITED)|\/QR[DTAPRM]|\/Q[A-Z]{2}LC\//.test(
      t,
    )
  )
    return "hazard";
  if (
    /FIRING|FRNG|GUNNERY|\bGUNS?\s+(?:FIRING|FRNG|EXER|EXERCISE|ACTIVITY|OPS)\b|(?:FIRING|FRNG)\s+(?:OF\s+)?GUNS?\b|MISSILE|ROCKET|LAUNCH|\/QWM|MSL\s+(EXER|FRNG|FIRING)/.test(
      t,
    )
  )
    return "firing";
  if (/TRAINING|\bTRG\b|MIL(?:ITARY)?\s+EXER|AIR\s+EXER|\/QW[VE]/.test(t))
    return "training";
  if (/DRONE|UNMANNED|\b(UAS|UAV|RPAS)\b|\/QWU/.test(t)) return "drone";
  return "other";
}
function radiusMeters(text: string) {
  const m = normalizeCoordinateText(text).match(
    /(?:RADIUS|RAD)\s*(?:OF\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(NM|KM|M|FT)\b|\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(NM|KM|M|FT)\s*(?:RADIUS|RAD)\b/,
  );
  if (!m) return null;
  const n = Number((m[1] || m[3]).replace(/,/g, "")),
    unit = m[2] || m[4];
  const nm =
    unit === "NM"
      ? n
      : unit === "KM"
        ? n / 1.852
        : unit === "FT"
          ? n / 6076.11549
          : n / 1852;
  return nm > 0 && nm < MAX_RADIUS_NM
    ? n *
        (unit === "NM"
          ? 1852
          : unit === "KM"
            ? 1000
            : unit === "FT"
              ? 0.3048
              : 1)
    : null;
}

/** Preserve multipart continuations, including text after repeated F/G fields.
 * F/G scalar values are harmless to the hemisphere-pair lexer; cutting at the
 * first F/G was silently deleting later published areas. */
export function extractNoticeBody(text: string) {
  const t = text.toUpperCase();
  const marker = /(?:^|[\s(])E\)\s*/.exec(t);
  return marker ? t.slice(marker.index + marker[0].length) : t;
}

export function coordinateWarnings(text: string): string[] {
  const t = normalizeCoordinateText(text);
  const warnings: string[] = [];
  if (t.includes("INVALIDCOORD")) warnings.push("度・分・秒表記の座標が不完全、または範囲外です。欠けた数値を補わず、その位置は未描画です。");
  const token = /(?<![\d.])(\d+(?:\.\d+)?)([NSEW])(?![A-Z])/g;
  const tokens = [...t.matchAll(token)].filter(m => {
    const before=t.slice(Math.max(0,m.index!-40),m.index!);
    // Aircraft model suffixes such as EA-300S are not coordinate components.
    // Limit this exemption to an explicit aircraft field and a model prefix.
    const linePrefix=t.slice(t.lastIndexOf("\n",m.index!)+1,m.index!);
    if (/\b(?:USING\s+)?ACFT\s+/.test(linePrefix)
        && /\b[A-Z][A-Z0-9]*-$/.test(before)) return false;
    return !(m[2] === "W" && /\bPOWER\s*[=:]?\s*$/.test(before))
      && !(/[EW]/.test(m[2]) && /\b(?:[EW] SIDE OF|EAST OF|WEST OF)\s*$/.test(before));
  });
  const invalid = tokens.filter((m) => !Number.isFinite(parseAngle(m[1], /[NS]/.test(m[2]), m[2])));
  if (invalid.length) warnings.push(`範囲・形式が不正な座標成分 ${invalid.length}件は描画できません: ${invalid.map(m => m[0]).join(", ")}`);
  const invalidDecimal = [...t.matchAll(/(?<![\d.])(?:LAT(?:ITUDE)?\s*=?\s*)?([-+]?\d{1,3}\.\d+)(?:\s*[,;/]\s*|\s+)(?:LON(?:GITUDE)?\s*=?\s*)?([-+]?\d{1,3}\.\d+)(?![\d.])|LAT(?:ITUDE)?\s*=?\s*([-+]?\d{1,3}\.\d+)[\s,;/]+LON(?:GITUDE)?\s*=?\s*([-+]?\d{1,3}\.\d+)(?![\d.])|LON(?:GITUDE)?\s*=?\s*([-+]?\d{1,3}\.\d+)[\s,;/]+LAT(?:ITUDE)?\s*=?\s*([-+]?\d{1,3}\.\d+)(?![\d.])/g)].filter(m => {
    const lat=Number(m[1] || m[3] || m[6]), lon=Number(m[2] || m[4] || m[5]);
    return Math.abs(lat)>90 || Math.abs(lon)>180;
  });
  if(invalidDecimal.length) warnings.push(`範囲外の十進座標 ${invalidDecimal.length}件は描画できません: ${invalidDecimal.map(m=>m[0]).join(", ")}`);
  // Count pairs independently of de-duplicated coordinate output.
  const pair = /(?<![A-Z0-9.])(?:(\d{1,6}(?:\.\d+)?)([NS])\s*[- /,;]*\s*(\d{1,7}(?:\.\d+)?)([EW])|(\d{1,7}(?:\.\d+)?)([EW])\s*[- /,;]*\s*(\d{1,6}(?:\.\d+)?)([NS]))(?![A-Z0-9])/g;
  const spans = [...t.matchAll(pair)].map(m => [m.index!, m.index! + m[0].length]);
  const unmatched = tokens.filter(m => !spans.some(([a,b]) => m.index! >= a && m.index! + m[0].length <= b));
  if (unmatched.length) warnings.push(`対になる緯度・経度を確認できない座標成分 ${unmatched.length}件: ${unmatched.map(m => m[0]).join(", ")}`);
  return warnings;
}

export function isInactiveNotice(text: string) {
  const t = text.toUpperCase();
  const e = extractNoticeBody(t).replace(/\s+[FG]\)[\s\S]*$/, "").trim();
  // Only a NOTAMC header or an unequivocal whole-notice completion statement.
  // "CNL ..." may cancel just one area/period, so it cannot hide the notice.
  return /(?:^|\n)\s*\(?[A-Z]\d{4}\/\d{2}\s+NOTAMC\b/.test(t)
    || /^NOTAMC\b/.test(t.trim())
    || /^(?:NOTAM\s+CNL|(?:AIR\s+EXER|EXER|ACT|ROUTE\s+RESTRICTIONS?)\s+CMPL|RESUMED\s+NML)[.\s]*$/.test(e);
}

function namedAirspaceShapes(body: string, warnings: string[]) {
  const shapes: Shape[] = [];
  const upper = body.toUpperCase();
  const matches: { key: string; definition: string; source: string }[] = [];
  const add = (key: string, definition: string | undefined, source: string) => {
    if (definition && !matches.some((item) => item.key === key)) matches.push({ key, definition, source });
  };
  for (const match of upper.matchAll(/\bRK\s*([RDP])\s*(\d+[A-Z]?)\b/g)) {
    const key = `RK${match[1]}${match[2]}`;
    add(key, koreaAirspaceDefinitions[key], "韓国AIP");
  }
  for (const match of upper.matchAll(/\b(MOA|CATA)\s*(\d+[A-Z]?)\b/g)) {
    const key = `${match[1]}${match[2]}`;
    add(key, koreaAirspaceDefinitions[key], "韓国AIP");
  }
  for (const match of upper.matchAll(/\bUHD\s*(\d{3})\b/g)) {
    const key = `UHD${match[1]}`;
    add(key, russiaAirspaceDefinitions[key], "ロシア運輸省公示");
  }
  for (const match of upper.matchAll(/\bIMTA[ -]?(\d{1,2})\b/g)) {
    const key = `IMTA${match[1]}`;
    add(key, philippinesAirspaceDefinitions[key], "フィリピン空域資料");
  }
  for (const match of upper.matchAll(/\bRP[\s-]*\(?([RT])\)?[\s-]*(\d{1,2})\b/g)) {
    const key = `RP${match[1]}${match[2]}`;
    add(key, philippinesAirspaceDefinitions[key], "フィリピン空域資料");
  }
  for (const { definition } of matches) {
    if (!definition) continue;
    const points = sanitizePoints(coordinates(definition), warnings);
    const radius = radiusMeters(definition);
    if (radius && points.length === 1) shapes.push({ kind: "circle", points, radius });
    else if (points.length >= 3) shapes.push({ kind: "polygon", points: [...points, points[0]] });
    else if (points.length === 2) shapes.push({ kind: "line", points });
  }
  for (const source of new Set(matches.map((item) => item.source)))
    warnings.push(`${source}の公示境界を空域名から照合`);
  return shapes;
}

/** Detect proper crossings in source order; never reorder source vertices to
 * make a filled face. Adjacent edges and their shared endpoints are excluded. */
export function polygonSelfIntersects(points: Point[]) {
  if(points.length<4) return false;
  const ring=same(points[0],points[points.length-1]) ? points : [...points,points[0]];
  const orient=(a:Point,b:Point,c:Point)=>(b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1]);
  const opposite=(a:number,b:number)=>(a>1e-12&&b< -1e-12)||(a< -1e-12&&b>1e-12);
  for(let i=0;i<ring.length-1;i++) for(let j=i+2;j<ring.length-1;j++) {
    if(i===0&&j===ring.length-2) continue;
    const a=ring[i],b=ring[i+1],c=ring[j],d=ring[j+1];
    if(opposite(orient(a,b,c),orient(a,b,d))&&opposite(orient(c,d,a),orient(c,d,b))) return true;
  }
  return false;
}

// Aircraft applicability exceptions do not cut holes in the published area.
// Keep every unrecognized exception conservative, including spatial qualifiers.
function hasUnresolvedGeometryExclusion(text: string) {
  const geometryText=text
    // This is a communication applicability clause, not an exclusion from the
    // avoidance area. Match its complete explicit CONTACT construction only.
    .replace(/\bAIRSPACE\(EXC\s+EACH\s+CTR\s+AND\s+INFO\s+ZONE\)\s+ARE\s+REQUESTED\s+TO\s+CONTACT\b/g, "AIRSPACE ARE REQUESTED TO CONTACT")
    .replace(/\bEXC\s+ACFT\s+OF\s+GOVERNMENT\s+AGENCIES\b/g, "EXEMPT ACFT OF GOVERNMENT AGENCIES")
    .replace(/\bEXC\s+(?=(?:DEPARTURE\s+ACFT|EMERG\s+ACFT|SKED\s+CIV\s+ACFT|PRE\s+COORDINATED\s+ACFT|ATC\s+CONTROLLED\s+ACFT|APPROVED\s+TAKE-OFF\/LDG\s+FLT)\b)/g, "EXEMPT ");
  // Narrow positive spatial negations, not aircraft permission exceptions.
  if (/\bUAS\s+WILL\s+NOT\s+ENTER\s+(?:RCR\d+|[A-Z ]+HOSPITAL\s+HELIPORT)\b/.test(geometryText)
    || /\bCLOSURE\s+NOT\s+AFFECT\s+[^.\n]*\bAREAS?\s+UH[A-Z0-9]+/.test(geometryText)
    || /\b(?:PROHIBITED|RESTRICTED)\s+AREA\s*\([^\n]+\)\s+NOT\s+INCLUDED\b/.test(geometryText)) return true;
  return /\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS)\b/.test(geometryText);
}

/** Recognize a published WGS84/Tokyo-datum duplicate center, not two sites.
 * Require both explicit datum labels and exactly two coordinate pairs. */
function preferredDatumCoordinates(block: string, points: Point[]) {
  if (points.length !== 2 || !/\bRADIUS\b/.test(block)) return points;
  const matches = [...block.matchAll(/\d{4,6}(?:\.\d+)?[NS]\s*\d{5,7}(?:\.\d+)?[EW]\s*\(WGS-?84\)/g)];
  if (matches.length !== 1 || !/\(TOKYO\s+DATUM\)/.test(block)) return points;
  const selected = coordinates(matches[0][0]);
  return selected.length === 1 ? selected : points;
}

/** Only the explicitly ordered positive outer ring is eligible for an outline.
 * Stop before exclusion centers/remark coordinates; omit exactly identified
 * coastline edges. Unknown or unbound geographic clauses return no geometry. */
function knownPartialBoundary(block: string, excluded = true): Shape[] {
  if (hasGeometricArcText(block) || /\b(?:FAN[- ]SHAPED|SEMI[- ]?CIRCLE)\b/.test(block)) return [];
  // Explicit whole outer circles and explicitly closed rings survive unknown
  // spatial holes as outlines only. Never infer coastline edges or reorder points.
  const positive = block.split(/\b(?:EXC|EXCL|EXCLUD(?:E|ED|ING)|EXCEPT|RMK|UAS\s+WILL\s+NOT\s+ENTER|CLOSURE\s+NOT\s+AFFECT)\b/)[0];
  const outerPoints = coordinates(positive);
  const outerRadius = radiusMeters(positive);
  if (outerPoints.length === 1 && outerRadius && /\b(?:CIRCLE|RADIUS\s+CENTER(?:ED|RED)|RADIUS\s+CENTRED)\b/.test(positive))
    return [{kind:"circle", points:outerPoints, radius:outerRadius, partialBoundary:true}];
  if (/\b(?:AREA\s+AS\s+FLW|WI\s+AREA|TAKE\s+PLACE\s+WI)\b/.test(positive)
    && !/\b(?:COAST(?:LINE)?|SHORE|RIVER|ROAD|BOUNDARY|BDRY)\b/.test(block)
    && outerPoints.length >= 4 && same(outerPoints[0],outerPoints[outerPoints.length-1]))
    return [{kind:"line", points:outerPoints, partialBoundary:true}];
  const m = block.match(/\bBOUNDED\s+BY\s+(?:(?:FLW|THE|FOLLOWING)\s+)?POINTS?\s*([\s\S]*)/);
  if (!m) return [];
  const primary = m[1].split(/\b(?:TO\s+(?:THE\s+)?POINT\s+OF\s+ORIGIN|EXC|EXCL|EXCLUDE|EXCLUDED|EXCLUDING|EXCEPT|RMK|ALT|ATC|UAS\s+WILL\s+NOT\s+ENTER|CLOSURE\s+NOT\s+AFFECT)\b|\n\s*\(/)[0];
  let points = coordinates(primary);
  if (points.length < 3) return [];
  if (!same(points[0], points[points.length - 1])) points = [...points, points[0]];
  const hasGeographic = /\b(?:COAST(?:LINE)?|SHORE|RIVER|ROAD|BOUNDARY|BDRY)\b/.test(block);
  const coast = block.match(/THE\s+LINE\s+CONNECTING\s+POINT\s+([\s\S]*?)\s+IS\s+ALONG\s+THE\s+COASTLINE/);
  let omitted: Point[] = [];
  if (coast) omitted = coordinates(coast[1]);
  // A coast buffer exclusion does not alter the explicitly published outer
  // ring; its unknown excluded interior is still never filled.
  const coastBuffer = /EXCLUD?E?\s+AREA\s+WI\s+\d+(?:\.\d+)?NM\s+FM\s+COAST\s+LINE/.test(block);
  if (hasGeographic && !coastBuffer && (!coast || omitted.length !== 2)) return [];
  const isOmitted = (a:Point,b:Point) => omitted.length === 2 &&
    ((same(a,omitted[0])&&same(b,omitted[1]))||(same(a,omitted[1])&&same(b,omitted[0])));
  if (omitted.length && !points.slice(1).some((p,i)=>isOmitted(points[i],p))) return [];
  // User-selected coarse coastline mode: only a specifically identified edge
  // may be replaced by its straight chord. Other exclusions remain unfilled.
  if (omitted.length) {
    if (/\b(?:ALONG|FOLLOWING)\s+(?:THE\s+)?(?:RIVER|ROAD|SHORE|BOUNDARY|BDRY)\b/.test(block)) return [];
    const partial = excluded || polygonSelfIntersects(points);
    return [{kind:partial?"line":"polygon",points,partialBoundary:partial,coastlineApproximated:true,sourceReference:"海岸線を2点間の直線で代用した概略境界"}];
  }
  const shapes: Shape[] = []; let run:Point[] = [points[0]];
  for (let i=1;i<points.length;i++) {
    if (isOmitted(points[i-1],points[i])) {
      if (run.length>1) shapes.push({kind:"line",points:run,partialBoundary:true});
      run=[points[i]];
    } else run.push(points[i]);
  }
  if(run.length>1) shapes.push({kind:"line",points:run,partialBoundary:true});
  return shapes;
}

export function parseNotice(text: string, meta: Partial<Notice> = {}): Notice {
  const t = text.toUpperCase();
  const body = extractNoticeBody(t);
  const warnings: string[] = coordinateWarnings(body);
  const shapes: Shape[] = [];
  const inactive = isInactiveNotice(text);
  const excluded = hasUnresolvedGeometryExclusion(body);
  const localSections = splitExplicitBalloonAltitudeAreas(body);
  const groups = localSections ? localSections.flatMap(section=>geometryGroups(section).map(block=>({block,excluded:hasUnresolvedGeometryExclusion(section)}))) : geometryGroups(body).map(block=>({block,excluded}));
  for (const {block,excluded} of inactive ? [] : groups) {
    const originalPoints = sanitizePoints(coordinates(block), warnings);
    let pts = preferredDatumCoordinates(block, originalPoints);
    if (pts.length !== originalPoints.length) warnings.push("同じ地点の測地系別表記は、明記されたWGS84の座標を使います。Tokyo datumの位置を別地点として描きません。");
    if (coordinateWarnings(block).length) {
      pts.forEach(p => shapes.push({kind: "point", points: [p]}));
      warnings.push("不正または対応の取れない座標を含むため境界は未確定です。読めた座標だけを点で表示します。");
      continue;
    }
    if (hasConflictingRadiusUnits(block)) {
      pts.forEach(p=>shapes.push({kind:"point",points:[p]}));
      warnings.push("半径の単位別の数値が一致しません。値を選び直さず、中心点のみ表示します。");
      continue;
    }
    const radius = radiusMeters(block);
    const corridor = block.match(/(?:\b|(?<=WI))(\d+(?:\.\d+)?)\s*(NM|KM|M)\s+EITHER\s+SIDE\b/);
    const sector = excluded ? null : parseExplicitTrueBearingSector(block,pts);
    if (sector?.status === "resolved" && sector.points) { shapes.push({kind:"polygon",points:sector.points,interpolated:true}); warnings.push(...sector.warnings); continue; }
    const arc = excluded ? {status: "unsupported", points: undefined, warnings: []} : parseExplicitArcBoundary(block);
    if (arc.status === "resolved" && arc.points) { shapes.push({kind:"polygon",points:arc.points,interpolated:true}); warnings.push(...arc.warnings); continue; }
    if (arc.status === "unsupported") warnings.push(...arc.warnings);
    const complex = excluded || /\b(?:FAN[- ]SHAPED|SEMI[- ]?CIRCLE)\b/.test(block) || hasGeometricArcText(block) || /\b(?:ALONG|FOLLOWING)\s+(?:THE\s+)?(?:COAST|SHORE|BOUNDARY|BDRY|RIVER|ROAD)/.test(block) || hasUnresolvedGeometryExclusion(block);
    const radiusCount = [...normalizeCoordinateText(block).matchAll(/(?:RADIUS|RAD)\s*(?:OF\s*)?\d|\d+(?:\.\d+)?\s*(?:NM|KM|M|FT)\s*(?:RADIUS|RAD)\b/g)].length;
    if (complex && pts.length) {
      const partial: Shape[] = excluded && radius && radiusCount === 1 && pts.length === 1
        && !hasGeometricArcText(block) && !/\b(?:FAN[- ]SHAPED|SEMI[- ]?CIRCLE)\b/.test(block)
        ? [{kind:"circle",points:pts,radius,partialBoundary:true}] : knownPartialBoundary(block,excluded);
      const referenced = partial.length ? applyPublishedExclusion(text, block, partial) : null;
      if (referenced) {
        shapes.push(...referenced);
        warnings.push("山形情報圏の除外に国土交通省・国土地理院の参考境界を使用（配信更新2026年3月19日、確認2026年10月3日）。最新AIPとの一致は未確認です。https://www.mlit.go.jp/koku/koku_tk10_000004.html");
      } else if (partial.length) {
        shapes.push(...partial);
        for (const p of pts) if (!partial.some(s=>s.points.some(q=>same(p,q)))) shapes.push({kind:"point",points:[p],partialBoundary:true,sourceReference:"除外範囲などの参照位置（活動地点ではありません）"});
        if (partial.some(s=>s.coastlineApproximated)) warnings.push("海岸線の辺は、明示された2点間の直線で代用しています。実際の海岸形状とは異なる概略境界です。");
        if (partial.some(s=>s.partialBoundary)) warnings.push("既知の外周境界のみ表示しています。除外空域・高度別条件などの未確定部分は補完せず、区域を塗りつぶしていません。");
      } else {
        pts.forEach(p => shapes.push({ kind: "point", points: [p] }));
        warnings.push("扇形・半円・円弧・地物に沿う境界・除外区域を含むため区域の形状は未確定です。原文の座標のみ表示し、区域を塗りつぶしていません。");
      }
    } else if (radiusCount > 1 && pts.length > 1) {
      pts.forEach(p => shapes.push({ kind: "point", points: [p] }));
      warnings.push("複数の半径と中心の対応が未確定です。座標のみ表示しています。");
    } else if (corridor) {
      const reconstructed = parseExplicitCorridor(normalizeCoordinateText(block),coordinates);
      if (reconstructed.status === "resolved") shapes.push(...reconstructed.shapes);
      else pts.forEach(p=>shapes.push({kind:"point",points:[p],partialBoundary:true}));
      warnings.push(...reconstructed.warnings);
    } else if (radius && pts.length === 1)
      shapes.push({ kind: "circle", points: pts, radius });
    else if (pts.length > 1 && /\bLINE\s+(?:JOINING|CONNECTING)\b/.test(block) && !/\bBOUNDED\s+BY\b|\bPOLYGON\b/.test(block))
      shapes.push({ kind: "line", points: pts });
    else if (pts.length > 1 && (hasPathContext(block)
      // WI/AT COORD alone does not authorize closure, but an already closed
      // coordinate sequence in this explicit location clause is a boundary.
      || (pts.length>=4 && same(pts[0],pts[pts.length-1])
        && /\b(?:WI|AT\s+COORD(?:INATES)?)\s+(?=\d{4,6}(?:\.\d+)?[NS])/.test(block))
      || (/\bTMA\s+ESTABLISHED\b/.test(block) && /\bLATERAL\s+LIMITS\b/.test(block)
        && !/\b(?:REMOVE|DELETE|WITHDRAW)\b/.test(block)))) {
      const explicit =
        EXPLICIT_CLOSE.test(block) || same(pts[0], pts[pts.length - 1]);
      if (explicit && !same(pts[0], pts[pts.length - 1]))
        pts = [...pts, pts[0]];
      const clearlyBounded = /\b(?:BOUNDED|BND)\s+BY\b|\bPOLYGON\b|\bWI(?:THIN)?\s+AREA\b/.test(block);
      if (pts.length >= 3 && (explicit || clearlyBounded)) {
        if (polygonSelfIntersects(pts)) {
          shapes.push({kind:"line",points:pts});
          warnings.push("本文の頂点順で境界が自己交差します。原文の順序を保って線だけを表示し、区域を塗りつぶしていません。");
        } else {
          shapes.push({ kind: "polygon", points: pts, inferredClose: !explicit });
          if (!explicit) warnings.push("点で囲まれた区域の始点と終点を補助線で閉合");
        }
      } else {
        shapes.push({ kind: "line", points: pts });
        if (pts.length >= 3) warnings.push("区域の閉合が明示されていないため線として表示しています。");
      }
    } else pts.forEach((p) => shapes.push({ kind: "point", points: [p] }));
  }
  const namedAmbiguous = /\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS)\b|\b(?:NOT|DEACTIVATED|INACTIVE)\b/.test(body);
  if (!shapes.length && !inactive && !namedAmbiguous) shapes.push(...namedAirspaceShapes(body, warnings));
  if (namedAmbiguous && !shapes.length) warnings.push("除外・否定条件を含みます。空域名だけから有効区域を確定していません。");
  if (!shapes.length && !inactive) {
    const q = t.match(
      /Q\)\s*[A-Z]{4}\/Q([A-Z]{2})[A-Z]{2}\/[^\n]*?([0-9]{4}[NS])\s*([0-9]{5}[EW])([0-9]{3})(?:\s|$)/,
    );
    if (q) {
      const p = coordinates(q[2] + q[3]);
      if (p.length) {
        const isAreaActivity = /^[RW]/.test(q[1]);
        if (!namedAmbiguous && isAreaActivity && +q[4] > 0 && +q[4] < MAX_RADIUS_NM)
          shapes.push({
            kind: "circle",
            points: p,
            radius: +q[4] * 1852,
            approx: true,
          });
        else {
          shapes.push({ kind: "point", points: p, approx: true });
          warnings.push(
            isAreaActivity
              ? "Q行の半径が0または900 NM以上のため中心点のみ"
              : "施設・経路情報のためQ行中心点のみ",
          );
        }
      }
    }
  }
  if (inactive) warnings.push("取消・終了済みのため描画対象外");
  if (/\d{1,3}\.\d{3,}\.\d{3,}/.test(body)) warnings.push("座標の数値が区切りなしで連結されています。判読できる座標だけを表示し、区域の境界は原文確認が必要です。");

  if (!shapes.length && !inactive) warnings.push("描画可能な座標なし");
  for (const shape of shapes) shape.provenance ??= "text";
  const start = t.match(/B\)\s*(\d{10})/)?.[1] || "";
  const end = t.match(/C\)\s*(\d{10}|PERM)/)?.[1] || "";
  if (start && dateUTC(start) === null) warnings.push(`B欄の日時が不正です: ${start}`);
  if (end && end !== "PERM" && dateUTC(end) === null) warnings.push(`C欄の日時が不正です: ${end}`);
  if (/C\)\s*\d{10}\s*EST\b/.test(t)) warnings.push("C欄の終了時刻は見込み（EST）です。終了・更新状況を原文で確認してください。");
  return {
    id: t.match(/\b[A-Z]\d{4}\/\d{2}\b/)?.[0] || "番号不明",
    location: t.match(/A\)\s*([A-Z]{4})/)?.[1] || "",
    text,
    cancelled: inactive,
    issued: null,
    start: dateUTC(t.match(/B\)\s*(\d{10})/)?.[1] || ""),
    end: dateUTC(end),
    permanent: end === "PERM",
    purpose: classify(t),
    shapes,
    warnings: Array.from(new Set(warnings)),
    ...meta,
  };
}

export function sourceGeometry(parsed: Notice, provided: Shape[]) {
  if (parsed.cancelled || isInactiveNotice(parsed.text)) return [];
  // Source polygons retain arcs and other boundary detail absent from the text.
  if (provided.some((shape) => shape.provenance === "provider" && !shape.approx && shape.kind === "polygon")) {
    // Provider detail does not prove that every E-field section was supplied.
    // Preserve text geometries unless their exact shape is already represented.
    const key = (shape: Shape) => JSON.stringify([shape.kind, shape.radius || null, shape.points]);
    const result = [...provided];
    const seen = new Set(result.map(key));
    for (const shape of parsed.shapes.filter(shape => !shape.approx)) {
      if (!seen.has(key(shape))) {
        // Never cover source holes with an independently reconstructed filled face.
        // Ambiguous correspondence remains visible as an unfilled boundary.
        const supplemental:Shape=shape.kind === "polygon" ? {...shape,kind:"line",holes:undefined,inferredClose:undefined} : shape;
        result.push(supplemental); seen.add(key(shape));
      }
    }
    if (result.length > provided.length) parsed.warnings.push("取得元の詳細図形と本文の追加図形を併記しています。対応が未確定な本文の多角形は線だけにし、取得元の穴や除外部分を塗りつぶしません。");
    return result;
  }
  const exact = parsed.shapes.filter((shape) => !shape.approx);
  if (exact.length) {
    const providedPath = provided.some((shape) => !shape.approx && shape.kind === "line");
    const parsedPath = exact.some((shape) => shape.kind !== "point");
    if (providedPath && !parsedPath && provided.reduce((sum, shape) => sum + shape.points.length, 0) > exact.reduce((sum, shape) => sum + shape.points.length, 0)) return provided;
    return parsed.shapes;
  }
  return provided.length ? provided : parsed.shapes;
}

export function recoverNoticeGeometry(item: Notice): Notice {
  const parsed = parseNotice(item.text);
  // Legacy cached polygons may themselves be older parser output, not source
  // geometry. Never let them defeat corrected body parsing without provenance.
  const trusted = item.shapes.filter(shape => shape.provenance === "provider");
  const shapes = item.cancelled ? [] : sourceGeometry(parsed, trusted);
  const warnings = parsed.warnings.filter((warning) => (warning !== "描画可能な座標なし" || !shapes.length)
    && (!warning.startsWith("帯状区域の中心線") || shapes.some((shape) => shape.kind === "line")));
  return { ...item, cancelled: item.cancelled || parsed.cancelled, purpose: parsed.purpose, shapes, warnings };
}

export function parseRows(rows: string[][]): Notice[] {
  const header = rows.findIndex((r) =>
    r.some((c) => /NOTAM (Condition|Text)|NOTAM本文|原文/i.test(c)),
  );
  if (header < 0)
    throw Error(
      "NOTAM Condition または NOTAM Text 列が見つかりません。原文貼付も使えます。",
    );
  const h = rows[header];
  const idx = (rx: RegExp) => h.findIndex((c) => rx.test(c));
  const ti = idx(/NOTAM (Condition|Text)|NOTAM本文|原文/i),
    ii = idx(/Issue|発出/i),
    si = idx(/Start|Effective Date|開始/i),
    ei = idx(/End Date|Expiration Date|終了/i),
    li = idx(/^Location|ICAO.*コード/i);
  return rows
    .slice(header + 1)
    .filter((r) => r[ti]?.trim())
    .map((r) =>
      parseNotice(r[ti], {
        issued: dateUTC(r[ii] || ""),
        ...(r[si] ? { start: dateUTC(r[si]) } : {}),
        ...(r[ei]
          ? { end: dateUTC(r[ei]), permanent: /PERM/i.test(r[ei]) }
          : {}),
        ...(r[li] ? { location: r[li] } : {}),
      }),
    );
}

export function applyNoticeLifecycle(notices:Notice[],now=Date.now()):Notice[] {
  const changes=new Map<string,{id:string;kind:string;uncertain:boolean}>();
  for(const n of notices){
    const header=n.text.split(/(?:^|\s)[QAB]\)/)[0];
    const m=header.match(/\b[A-Z]\d{4}\/\d{2}\s+NOTAM([CR])\s+([A-Z]\d{4}\/\d{2})\b/i);
    if(!m)continue;
    const effect=n.issued ?? n.start;
    if(effect !== null && effect>now)continue;
    const key=`${n.location}|${m[2].toUpperCase()}`;
    const previous=changes.get(key);
    if(!previous || previous.uncertain) changes.set(key,{id:n.id,kind:m[1].toUpperCase(),uncertain:effect===null});
  }
  return notices.map(n=>{const change=changes.get(`${n.location}|${n.id.toUpperCase()}`);if(!change)return n;
    const warning=change.uncertain?`${change.id}に取消し・置換の参照がありますが、発出時刻が不明です。最新の原文を確認してください。`:`${change.id}による${change.kind === "C"?"取消し":"置換"}を確認しました。`;
    return {...n,cancelled:change.uncertain?n.cancelled:true,lifecycleUncertain:change.uncertain,shapes:change.uncertain?n.shapes:[],warnings:[...new Set([...n.warnings,warning])]};});
}
export function resolveReferencedGeometry(input: Notice[]) {
  const notices=applyNoticeLifecycle(input);
  const byId = new Map(notices.map((notice) => [`${notice.location}|${notice.id.toUpperCase()}`, notice]));
  return notices.map((notice) => {
    const ownDetailed = notice.shapes.some(
      (shape) => !shape.approx && shape.kind !== "point",
    );
    if (notice.cancelled || isInactiveNotice(notice.text) || /\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS)\b/i.test(extractNoticeBody(notice.text)) || ownDetailed || !/ROUTE RESTRICTIONS?/i.test(notice.text)) return notice;
    const ref = notice.text.match(/\bREF(?:ERENCE)?\s+NOTAM\s+([A-Z]\d{4}\/\d{2})\b/i)?.[1]?.toUpperCase();
    const source = ref ? byId.get(`${notice.location}|${ref}`) : undefined;
    const sourceShapes = source?.shapes.filter(
      (shape) => !shape.approx && shape.kind !== "point",
    );
    if (!sourceShapes?.length) return notice;
    return {
      ...notice,
      shapes: sourceShapes.map((shape) => ({
        ...shape,
        points: shape.points.map((point) => [...point] as Point),
      })),
      warnings: Array.from(
        new Set([
          ...notice.warnings.filter((warning) => !/Q行/.test(warning)),
          `参照先NOTAM ${ref} の公示区域を表示`,
        ]),
      ),
    };
  });
}
