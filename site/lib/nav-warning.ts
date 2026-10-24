import {navDates,navPeriods,navPeriodWarnings} from "./nav-period";
export {navDates,navPeriods,navIsActive,navOverlaps,navStartsWithin,navPeriodAnalysis,navPeriodWarnings,partialPeriodWarning} from "./nav-period";
import { coordinates, normalizeCoordinateText, sanitizePoints, type Point, type Notice, type Purpose, type Shape } from "./notam";
import { warningNumber } from "./nav-id";

const entityMap: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeHtml(value: string) {
  return value
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (_, key: string) => {
      if (key[0] === "#") {
        const hex = key[1]?.toLowerCase() === "x";
        return String.fromCodePoint(parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      return entityMap[key.toLowerCase()] || `&${key};`;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function classifyNavWarning(text: string): Purpose {
  if (/军事|軍事|军演|軍演|实弹|實彈|射击|射擊|火箭|导弹|導彈|发射|發射|演习|演習|军用|軍用|部队|部隊|武器/.test(text)) return "firing";
  return "other";
}

function navCoordinateText(text: string) {
  // Normalize complete angles before looking for prefix hemispheres. Otherwise
  // the N in "20°11.87′N 115°39.66′E" consumes the longitude as a latitude.
  const angle = (degree: string, minute: string, second: string | null, hemisphere: string) => {
    const latitude = /[NS]/i.test(hemisphere), d = Number(degree), m = Number(minute), s = Number(second ?? 0);
    if (m >= 60 || s >= 60 || d > (latitude ? 90 : 180) || (d === (latitude ? 90 : 180) && (m > 0 || s > 0))) return " INVALID_COORDINATE ";
    const pad = (value: string) => value.replace(/^(\d)(?=\.|$)/, "0$1");
    return degree.padStart(latitude ? 2 : 3, "0") + pad(minute) + (second === null ? "" : pad(second)) + hemisphere.toUpperCase();
  };
  const converted = text.replace(/北纬/g, "N ").replace(/南纬/g, "S ").replace(/东经/g, "E ").replace(/西经/g, "W ")
    .replace(/[‐‑‒–—−－]/g, "-").replace(/[、，；：:]/g, (value) => value === "；" ? ";" : ",")
    .replace(/(\d)\.\s+(\d)/g, "$1.$2")
    .replace(/(?<![\d.])(\d{1,3})\s*[°º度]\s*(\d{1,2})\s*[′'’分]\s*(\d{1,2}(?:\.\d+)?)\s*[″"”秒]\s*([NSEW])/gi,
      (_, d: string, m: string, s: string, h: string) => angle(d, m, s, h))
    .replace(/(?<![\d.])(\d{1,3})\s*[°º度]\s*(\d{1,2}(?:\.\d+)?)\s*[′'’分]\s*([NSEW])/gi,
      (_, d: string, m: string, h: string) => angle(d, m, null, h))
    .replace(/([NSEW])\s*(\d{1,3})\s*[°º度]\s*(\d{1,2})\s*[′'’分]\s*(\d{1,2}(?:\.\d+)?)\s*[″"”秒]/gi,
      (_, h: string, d: string, m: string, s: string) => angle(d, m, s, h))
    .replace(/([NSEW])\s*(\d{1,3})\s*[°º度]\s*(\d{1,2}(?:\.\d+)?)\s*[′'’分]/gi,
      (_, h: string, d: string, m: string) => angle(d, m, null, h))
    .replace(/(?<![\d.])(\d{1,3})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2}(?:\.\d+)?)\s*([NSEW])/gi,
      (_, d: string, m: string, s: string, h: string) => angle(d, m, s, h))
    .replace(/(?<![\d.\-])(\d{1,3})\s*-\s*(\d{1,2}(?:\.\d+)?)\s*[′'’分]?\s*([NSEW])/gi,
      (_, d: string, m: string, h: string) => angle(d, m, null, h));
  return normalizeCoordinateText(converted);
}

const navPair = "\\d{1,6}(?:\\.\\d+)?[NS][- /,;\\s]*\\d{1,7}(?:\\.\\d+)?[EW]";
const viaMarker = /航经|途经|途径|经由|经过/;
function orderedRoutes(text: string): Shape[] | null {
  if (!/拖带|拖航|曳航|航经|途经|途径|经由|航线|试航/.test(text)) return null;
  // Keep coordinate positions so route roles are read from their own clauses.
  const spans = [...text.matchAll(new RegExp(navPair, "g"))].flatMap((match) => {
    const point = coordinates(match[0])[0];
    return point ? [{ point, start: match.index!, end: match.index! + match[0].length }] : [];
  });
  const prefix = (index: number) => text.slice(index ? spans[index - 1].end : 0, spans[index].start);
  const origins = spans.flatMap((_, index) => /(?:从|自|由)[^，,。；;\n\d]{0,30}$/.test(prefix(index)) ? [index] : []);
  const used = new Set<number>(), shapes: Shape[] = [];
  for (let route = 0; route < origins.length; route++) {
    const origin = origins[route], limit = origins[route + 1] ?? spans.length;
    let target = origin + 1;
    while (target < limit && !/(?:前往|驶往|开往|拖往|到达|至|到)[^，,。；;\n\d]{0,30}$/.test(prefix(target))) target++;
    if (target >= limit) continue;
    const tailEnd = spans[limit]?.start ?? text.length;
    const tail = text.slice(spans[target].end, tailEnd), via = viaMarker.exec(tail);
    if (!via) continue;
    const viaStart = spans[target].end + via.index + via[0].length;
    const endOffset = text.slice(viaStart, tailEnd).search(/[。！？]/);
    const viaEnd = endOffset < 0 ? tailEnd : viaStart + endOffset;
    const after = spans.flatMap((span, index) => index > target && index < limit && span.start >= viaStart && span.end <= viaEnd ? [index] : []);
    if (!after.length) continue;
    // Coordinates before a declared destination need an explicit via clause too.
    const before = Array.from({ length: target - origin - 1 }, (_, index) => origin + index + 1);
    if (before.length && !viaMarker.test(text.slice(spans[origin].end, spans[target].start))) continue;
    const order = [origin, ...before, ...after, target];
    const points = sanitizePoints(order.map((index) => spans[index].point));
    if (points.length < 2) continue;
    order.forEach((index) => used.add(index));
    shapes.push({ kind: "line", points });
  }
  if (!shapes.length) return null;
  return [...shapes, ...spans.filter((_, index) => !used.has(index)).map(({ point }) => ({ kind: "point" as const, points: [point] }))];
}

const radians = (value: number) => value * Math.PI / 180;
const degrees = (value: number) => value * 180 / Math.PI;
function bearing(center: Point, point: Point) {
  const a = radians(center[0]), b = radians(point[0]), delta = radians(point[1] - center[1]);
  return (degrees(Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta))) + 360) % 360;
}
function sphericalDistance(a: Point, b: Point) {
  const lat = radians(b[0] - a[0]), lon = radians(b[1] - a[1]);
  const value = Math.sin(lat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(lon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function destination(center: Point, direction: number, distance: number): Point {
  const lat = radians(center[0]), lon = radians(center[1]), angle = radians(direction), delta = distance / 6371008.8;
  const targetLat = Math.asin(Math.sin(lat) * Math.cos(delta) + Math.cos(lat) * Math.sin(delta) * Math.cos(angle));
  const targetLon = lon + Math.atan2(Math.sin(angle) * Math.sin(delta) * Math.cos(lat), Math.cos(delta) - Math.sin(lat) * Math.sin(targetLat));
  return [degrees(targetLat), ((degrees(targetLon) + 540) % 360) - 180];
}
function sectorShape(text: string, points: Point[]): Shape[] {
  const angle = Number(text.match(/圆心角(?:为)?\s*(\d+(?:\.\d+)?)\s*[°度]/)?.[1]);
  if (points.length !== 3 || !/顶点|圆心/.test(text) || !/端点/.test(text) || !(angle > 0 && angle < 360)) return [];
  const [center, start, end] = points, first = bearing(center, start), last = bearing(center, end);
  const clockwise = (last - first + 360) % 360;
  const sweep = Math.abs(clockwise - angle) <= Math.abs(360 - clockwise - angle) ? clockwise : clockwise - 360;
  const r1 = sphericalDistance(center, start), r2 = sphericalDistance(center, end);
  if (Math.abs(Math.abs(sweep) - angle) > 3 || Math.abs(r1 - r2) > Math.max(r1, r2) * .05 || r1 <= 0) return [];
  const steps = Math.ceil(Math.abs(sweep) / 2), arc: Point[] = [start];
  for (let index = 1; index < steps; index++) arc.push(destination(center, first + sweep * index / steps, r1 + (r2 - r1) * index / steps));
  return [{ kind: "polygon", points: [center, ...arc, end, center] }];
}
function radiusMeters(amount: string, unit: string) {
  return Number(amount) * (/海里|NM/i.test(unit) ? 1852 : /公里|千米|KM/i.test(unit) ? 1000 : 1);
}
function radialSectors(text: string): { shapes: Shape[]; remaining: string } {
  const shapes: Shape[] = [];
  const remaining = text.replace(new RegExp(`(${navPair})\\s*(?:点)?为(?:圆心|中心)[,\\s]*方位\\s*(\\d+(?:\\.\\d+)?)\\s*[-至到]\\s*(\\d+(?:\\.\\d+)?)[,\\s]*半径(?:为)?\\s*(\\d+(?:\\.\\d+)?)\\s*(海里|公里|千米|米|KM|NM|M)(?:的)?扇形`, "g"),
    (whole, coord: string, first: string, last: string, amount: string, unit: string) => {
      const center = coordinates(coord)[0], start = Number(first), end = Number(last), meters = radiusMeters(amount, unit);
      const sweep = (end - start + 360) % 360;
      if (!center || start >= 360 || end >= 360 || !sweep || !(meters > 0 && meters < 900 * 1852)) return whole;
      const count = Math.ceil(sweep / 2), points: Point[] = [center];
      for (let i = 0; i <= count; i++) points.push(destination(center, start + sweep * i / count, meters));
      points.push(center);
      shapes.push({ kind: "polygon", points });
      return "";
    });
  return { shapes, remaining };
}
function readNavShapes(text: string, areaContext = false): Shape[] {
  const normalized = navCoordinateText(text);
  const sectors = radialSectors(normalized);
  if (sectors.shapes.length) return [...readNavShapes(sectors.remaining, areaContext), ...sectors.shapes];
  // Parenthesized named sea areas are independent boundaries, never one polygon.
  const enclosed = [...text.matchAll(/(?:[A-Z]\d+|[一二三四五六七八九十\d]+)(?:海域|水域|区域)[（(]([^（）()]+)[）)]/g)];
  if (enclosed.length > 1 && enclosed.every((match) => coordinates(navCoordinateText(match[1])).length >= 3)) {
    let remainder = text;
    const shapes = enclosed.flatMap((match) => {
      remainder = remainder.replace(match[0], "");
      return readNavShapes(match[1], true);
    });
    return [...shapes, ...readNavShapes(remainder, areaContext)];
  }
  const declaredAreas = normalized.split(/(?:及)?以下[一二三四五六七八九十\d]+点(?:依次)?连线/).filter((part) => coordinates(part).length);
  if (declaredAreas.length > 1 && declaredAreas.every((part) => coordinates(part).length >= 3)) return declaredAreas.flatMap((part) => readNavShapes(part, true));
  const named = normalized.split(/(?:(?:区域|區域|水域|范围)[一二三四五六七八九十\d]+|航速试航区)(?:[：:,为]|为下列|\s+)/).filter((part) => coordinates(part).length);
  if (named.length > 1) return named.flatMap((part) => readNavShapes(part, true));
  // Each completed boundary phrase ends its own listed vertices.
  const boundaries: string[] = [];
  let boundaryEnd = 0;
  for (const match of normalized.matchAll(/连线(?:围成的|合围|附近)?(?:水域|海域)?(?:范围|区域)?(?:水域|海域)?(?:内)?/g)) {
    if (!/水域|海域|范围|区域/.test(match[0])) continue;
    const end = match.index! + match[0].length, part = normalized.slice(boundaryEnd, end);
    if (coordinates(part).length < 3) continue;
    boundaries.push(part); boundaryEnd = end;
  }
  if (boundaries.length > 1) return [...boundaries.flatMap((part) => readNavShapes(part, true)), ...readNavShapes(normalized.slice(boundaryEnd), areaContext)];
  const numbered = normalized.split(/[（(]\d+[）)](?=\s*(?:\d{1,6}(?:\.\d+)?[NS]|[NS]\s*\d))/).filter((part) => coordinates(part).length);
  const numberedVertices = numbered.length > 1 && numbered.every((part) => coordinates(part).length === 1) && !/分别/.test(text)
    && /(?:诸点|各点|[一二三四五六七八九十\d]+点)(?:依次)?连线|(?:依次|顺次)连线|连线[^。；;]{0,12}(?:范围|水域|海域|区域)/.test(text);
  if (numbered.length > 1 && !numberedVertices && /分别|区域|水域|范围/.test(text)) return numbered.flatMap((part) => readNavShapes(part, true));
  const areas = normalized.split(/(?:以及|及)(?=\s*\d{1,6}(?:\.\d+)?[NS])/).filter((part) => coordinates(part).length);
  if (areas.length > 1 && areas.every((part) => coordinates(part).length >= 3) && /连线(?:水域)?(?:范围)?/.test(text)) return areas.flatMap((part) => readNavShapes(part, true));
  // Capture each fixed circle separately, excluding its center from any polygon.
  const radius = "(?:半径(?:为)?\\s*(\\d+(?:\\.\\d+)?)\\s*(海里|公里|千米|米|KM|NM|M)|(\\d+(?:\\.\\d+)?)\\s*(海里|公里|千米|米|KM|NM|M)\\s*为半径)";
  const circles: Shape[] = [];
  let circleText = normalized.replace(new RegExp(`((?:${navPair})(?:\\s*[,;、和及]\\s*(?:${navPair}))+)(?:(?:以上)?\\d+点)?\\s*为圆心[,\\s]*${radius}`, "g"),
    (whole, coords: string, amount1: string, unit1: string, amount2: string, unit2: string) => {
      const centers = coordinates(coords), meters = radiusMeters(amount1 || amount2, unit1 || unit2);
      if (centers.length < 2 || !(meters > 0 && meters < 900 * 1852)) return whole;
      circles.push(...centers.map((point) => ({ kind: "circle" as const, points: [point], radius: meters })));
      return "";
    });
  const remaining = circleText.replace(new RegExp(`(${navPair})\\s*(?:[（(](?:CGCS2000|WGS-?84)(?:坐标系)?[）)]\\s*)?(?:点)?(?:为圆心|为中心)[，,\\s]*${radius}`, "g"), (whole, coord: string, amount1: string, unit1: string, amount2: string, unit2: string) => {
    const point = coordinates(coord)[0], amount = Number(amount1 || amount2), unit = unit1 || unit2;
    const meters = amount * (/海里|NM/.test(unit) ? 1852 : /公里|千米|KM/.test(unit) ? 1000 : 1);
    if (!point || !(meters > 0 && meters < 900 * 1852)) return whole;
    circles.push({ kind: "circle", points: [point], radius: meters });
    return "";
  });
  const points = sanitizePoints(coordinates(remaining));
  if (!points.length) return circles;
  if (/扇形/.test(text)) {
    const sectors = sectorShape(text, points);
    return [...(sectors.length ? sectors : points.map((point) => ({ kind: "point" as const, points: [point] }))), ...circles];
  }
  const routes = orderedRoutes(remaining);
  if (routes) return [...routes, ...circles];
  const closed = points.length > 3 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1];
  const polygonContext = areaContext || closed || /(?:诸点|各点|四点|以下\d*点)连线|连线[^。；;]{0,12}(?:范围|水域|海域|区域)|范围内|水域内|区域内/.test(text);
  if (points.length >= 3 && polygonContext) return [{ kind: "polygon", points }, ...circles];
  if (points.length >= 2 && /拖带|拖航|航经|航线/.test(text)) return [{ kind: "line", points }, ...circles];
  return [...points.map((point) => ({ kind: "point" as const, points: [point] })), ...circles];
}

function polygonVertices(points: Point[]) {
  const same = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  return points.length > 1 && same(points[0], points[points.length - 1]) ? points.slice(0, -1) : points;
}
function polygonSelfCrosses(points: Point[]) {
  const p = polygonVertices(points);
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
    if (i === 0 && j === p.length - 1) continue;
    const a = p[i], b = p[(i + 1) % p.length], c = p[j], d = p[(j + 1) % p.length];
    if (cross(a, b, c) * cross(a, b, d) < -1e-15 && cross(c, d, a) * cross(c, d, b) < -1e-15) return true;
  }
  return false;
}
const crossedGeometryWarning = "境界の座標順序が交差しています。区域を推測せず座標点を表示しています。原文を確認してください。";
const countGeometryWarning = "原文の境界点数と読み取れた座標点数が一致しません。区域を推測せず座標点を表示しています。原文を確認してください。";
const duplicateGeometryWarning = "原文の境界座標に重複があります。原文を確認してください。";
export function navGeometryWarnings(text: string, _shapes?: Shape[]) {
  // Re-read raw boundaries: the public shapes intentionally replace crossed fills.
  const raw = readNavShapes(text), polygons = raw.filter((shape) => shape.kind === "polygon");
  const warnings: string[] = [];
  if (/部分圆弧|部分圓弧/.test(text)) warnings.push("部分円弧の方向・境界を確定できません。区域を塗らず原文の座標点を表示しています。");
  if (/扇形/.test(text) && !polygons.length) warnings.push("扇形の中心・半径・方向を確定できません。判読できた座標点のみ表示しています。");
  if (polygons.some((shape) => polygonSelfCrosses(shape.points))) warnings.push(crossedGeometryWarning);
  const counts = [...text.matchAll(/([一二三四五六七八九十\d]+)点(?:依次|顺次)?连线/g)].map((match) => {
    if (/^\d+$/.test(match[1])) return Number(match[1]);
    const digits = "一二三四五六七八九";
    const parts = match[1].split("十");
    return parts.length === 2 ? (parts[0] ? digits.indexOf(parts[0]) + 1 : 1) * 10 + (parts[1] ? digits.indexOf(parts[1]) + 1 : 0) : digits.indexOf(match[1]) + 1;
  });
  if (counts.length && counts.length === polygons.length && counts.some((count, i) => count > 0 && polygonVertices(polygons[i].points).length !== count)) warnings.push(countGeometryWarning);
  if (polygons.some((shape) => {
    const points = polygonVertices(shape.points);
    return points.some((point, i) => points.slice(0, i).some((earlier) => Math.abs(point[0] - earlier[0]) < 1e-7 && Math.abs(point[1] - earlier[1]) < 1e-7));
  })) warnings.push(duplicateGeometryWarning);
  // Consecutive duplicates are removed by coordinates(); detect them in the raw tokens.
  if (counts.length) {
    const normalized = navCoordinateText(text), spans = [...normalized.matchAll(new RegExp(navPair, "g"))];
    if (spans.some((match, i) => i > 0 && match[0].replace(/\s/g, "") === spans[i - 1][0].replace(/\s/g, "") && /^[\s,;、]*$/.test(normalized.slice(spans[i - 1].index! + spans[i - 1][0].length, match.index)))) {
      if (!warnings.includes(duplicateGeometryWarning)) warnings.push(duplicateGeometryWarning);
    }
  }
  return warnings;
}
export function navShapes(text: string, areaContext = false): Shape[] {
  const warnings = navGeometryWarnings(text);
  const ambiguous = warnings.includes(countGeometryWarning) || warnings.includes(duplicateGeometryWarning) || /部分圆弧|部分圓弧/.test(text);
  return readNavShapes(text, areaContext).flatMap((shape) => shape.kind === "polygon" && (ambiguous || polygonSelfCrosses(shape.points))
    ? polygonVertices(shape.points).map((point) => ({ kind: "point" as const, points: [point] })) : [shape]);
}

export const unmappedWarning = "本文から描画できる座標を確認できませんでした。";
export const unknownPeriodWarning = "有効期間を自動判定できません。原文を確認してください。";
export const multiplePeriodWarning = "複数の有効時間帯があります。表示する開始・終了は全体の範囲です。間の休止時間と区域ごとの対応は原文・説明で確認してください。";

export function navWarningToNotice(input: { title: string; text: string; published: string; url: string; source: string }): Notice {
  const published = /^\d{4}-\d{2}-\d{2}$/.test(input.published) ? `${input.published}T00:00:00` : input.published.replace(" ", "T");
  const issued = Number.isFinite(Date.parse(`${published}+08:00`)) ? Date.parse(`${published}+08:00`) : null;
  const dates = navDates(input.text, issued);
  const id = input.title.match(warningNumber)?.[0].replace(/\s/g, "") || input.text.match(warningNumber)?.[0].replace(/\s/g, "") || input.title.match(/\b(?:CN|CE|CS|TJ|LN|HB|SD|LYG|JS|SH|ZJ|FJ|GD|SZ|GX|HN)\s*\d+\s*\/\s*(?:\d{2}|20\d{2})\b/)?.[0].replace(/\s/g, "") || input.title;
  const sea = input.text.match(/(?:航警\s*\d+\/\d+[，,]\s*)?([^，,。；;]{1,12}(?:海|湾|港|水道|航道|水域))/)?.[1] || "中国沿海";
  const shapes = navShapes(input.text);
  return {
    id, location: sea, text: input.text, issued, start: dates.start, end: dates.end,
    permanent: false, purpose: classifyNavWarning(`${input.title}\n${input.text}`), shapes,
    warnings: [...navPeriodWarnings(input.text,issued), ...navGeometryWarnings(input.text, shapes), ...(shapes.length ? [] : [unmappedWarning]), ...(dates.start === null || dates.end === null ? [unknownPeriodWarning] : []), ...(navPeriods(input.text, issued).length > 1 ? [multiplePeriodWarning] : []), ...(/每日|每天/.test(input.text) ? ["毎日の時間帯に条件があります。期間表示は初日から最終日までの概略です。"] : [])],
    sourceUrl: input.url, sourceName: input.source,
  };
}
