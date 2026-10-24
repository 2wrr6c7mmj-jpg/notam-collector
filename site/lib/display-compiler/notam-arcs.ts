/** Strict, bounded NOTAM arc support. Coordinates are [latitude, longitude].
 * A spherical display approximation, NEVER an authoritative navigation boundary.
 * No exclusion areas, named coastlines, inferred centers or inferred direction.
 */
export type ArcPoint = [number, number];
export type ArcResult = {
  status: 'not-applicable' | 'resolved' | 'unsupported';
  points?: ArcPoint[];
  approx?: true;
  warnings: string[];
  arc?: { start: ArcPoint; end: ArcPoint; center: ArcPoint; radiusMeters: number;
    direction: 'minor' | 'clockwise' | 'counterclockwise'; sweepDegrees: number };
};
const RAD = Math.PI / 180;
const EARTH = 6371008.8;
const COORD = String.raw`\d{6}(?:\.\d+)?[NS]\s*\d{7}(?:\.\d+)?[EW]`;
const CHAIN = `${COORD}(?:\\s*-\\s*${COORD})+`;
const APPROX_WARNING = '明示された円弧を球面上で補間した概略境界です（最大角度刻み1度）。原文の端点を保持しており、航法には使用できません。';
const fail = (reason: string): ArcResult => ({status:'unsupported', warnings:[reason]});
const same = (a: ArcPoint,b: ArcPoint) => Math.abs(a[0]-b[0])<1e-9 && Math.abs(a[1]-b[1])<1e-9;
const mod = (x: number,n: number) => ((x%n)+n)%n;
function coordinate(s: string): ArcPoint | null {
  const m=s.match(/^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)([EW])$/);
  if(!m || +m[2]>=60 || +m[3]>=60 || +m[6]>=60 || +m[7]>=60) return null;
  const p: ArcPoint=[(+m[1]+ +m[2]/60+ +m[3]/3600)*(m[4]==='S'?-1:1), (+m[5]+ +m[6]/60+ +m[7]/3600)*(m[8]==='W'?-1:1)];
  return Math.abs(p[0])<=90 && Math.abs(p[1])<=180 ? p : null;
}
function chain(s: string): ArcPoint[] | null {
  const matches=[...s.matchAll(new RegExp(COORD,'g'))];
  const pts=matches.map(m=>coordinate(m[0]));
  return pts.every(p=>p!==null) ? pts as ArcPoint[] : null;
}
export function sphericalDistanceMeters(a: ArcPoint,b: ArcPoint) {
  const h=Math.sin((b[0]-a[0])*RAD/2)**2+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin((b[1]-a[1])*RAD/2)**2;
  return 2*EARTH*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
function bearing(c: ArcPoint,p: ArcPoint) {
  const a=c[0]*RAD,b=p[0]*RAD,d=(p[1]-c[1])*RAD;
  return Math.atan2(Math.sin(d)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(d))/RAD;
}
function destination(c: ArcPoint,azimuth: number,radius: number): ArcPoint {
  const a=c[0]*RAD,b=azimuth*RAD,d=radius/EARTH;
  const lat=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(b));
  const lon=c[1]+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(lat))/RAD;
  return [lat/RAD,mod(lon+180,360)-180];
}
export function interpolateArc(start: ArcPoint,end: ArcPoint,center: ArcPoint,radiusMeters: number,direction: 'minor'|'clockwise'|'counterclockwise'): ArcResult {
  if (![start,end,center].every(p=>p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180) || !Number.isFinite(radiusMeters) || radiusMeters<=0 || radiusMeters>900*1852)
    return fail('円弧の座標または半径がサポート範囲外です。');
  if(same(start,end)) return fail('同一端点の円弧は全円かどうか判定できません。');
  // Coordinate rounding plus conservative spherical-vs-ellipsoidal allowance.
  // This is a display tolerance, not a statement of source accuracy.
  const tolerance=30+radiusMeters*0.006;
  if([start,end].some(p=>Math.abs(sphericalDistanceMeters(center,p)-radiusMeters)>tolerance))
    return fail('円弧の端点・中心・半径が整合しないため区域は未確定です。');
  const a=bearing(center,start),b=bearing(center,end),cw=mod(b-a,360);
  if(direction==='minor' && Math.abs(cw-180)<1e-6) return fail('180度の円弧に方向指定がないため区域は未確定です。');
  const sweep=direction==='clockwise'?cw:direction==='counterclockwise'?cw-360:cw<=180?cw:cw-360;
  if(Math.abs(sweep)<1e-7 || Math.abs(sweep)>359.999999) return fail('円弧の方位角が退化しています。');
  // <=1-degree increments AND <=25 m planar chord sagitta. Bounded radius keeps node count <600.
  const step=Math.min(1,2*Math.acos(Math.max(-1,1-25/radiusMeters))/RAD);
  const count=Math.ceil(Math.abs(sweep)/step);
  const points: ArcPoint[]=[start];
  for(let i=1;i<count;i++)points.push(destination(center,a+sweep*i/count,radiusMeters));
  points.push(end);
  return {status:'resolved',points,approx:true,warnings:[APPROX_WARNING],arc:{start,end,center,radiusMeters,direction,sweepDegrees:sweep}};
}
function completeBoundary(result: ArcResult, points: ArcPoint[]): ArcResult {
  // Map consumers need deliberate dateline splitting, which this bounded module
  // does not provide. Never produce a misleading globe-spanning polygon.
  if(points.some((p,i)=>i>0 && Math.abs(p[1]-points[i-1][1])>180))
    return fail('日付変更線を横断する円弧境界は未対応です。');
  return {...result,points};
}
export function hasGeometricArcText(input: string) {
  // ARC here is an aeronautical chart acronym, not a curved boundary.
  const t=input.toUpperCase().replace(/REVISION\s+TO\s+ARC\s*\(REF[^)]*\)/g,'');
  if (!/\bARCS?\b/.test(t) && /\bVOR\b/.test(t) && /\bRADIAL\b/.test(t) && !new RegExp(COORD).test(t)) return false;
  return /\bARCS?\b|\b(?:CLOCKWISE|COUNTERCLOCKWISE|ANTI-CLOCKWISE)\b/.test(t);
}
export function parseExplicitArcBoundary(input: string): ArcResult {
  const t=input.toUpperCase().replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
  if(!hasGeometricArcText(t)) return {status:'not-applicable',warnings:[]};
  if(/\b(?:EXC|EXCL|EXCLUDING|EXCLUDE|EXCLUDES|EXCLUDED|EXCEPT|OUTSIDE|MINUS)\b|\b(?:ALONG|FOLLOWING)\s+(?:THE\s+)?(?:COAST|COASTLINE|SHORE|BOUNDARY|BDRY|RIVER|ROAD)\b/.test(t))
    return fail('除外区域・地物境界を含む円弧は未対応です。座標のみ表示します。');
  if([...t.matchAll(/\bARCS?\b/g)].length!==1) return fail('複数または不明な円弧の構文は未対応です。');
  const minor=new RegExp(`(?:AREA\\s*:\\s*)?BOUNDED BY (?:FLW|THE FOLLOWING) POINTS\\s+(${CHAIN})\\s*[,.;]?\\s*THE LINE CONNECTING (${COORD}) TO (${COORD}) IS THE MINOR ARC WITH A RADIUS OF (\\d+(?:\\.\\d+)?)\\s*(NM|KM|M) FM (${COORD})(?=[ .;,]|$)`);
  const m=t.match(minor);
  if(m) {
    if([...t.matchAll(new RegExp(COORD,'g'))].length!==[...m[0].matchAll(new RegExp(COORD,'g'))].length) return fail('円弧以外の座標列との関係が未確定です。');
    const points=chain(m[1]),start=coordinate(m[2]),end=coordinate(m[3]),center=coordinate(m[6]);
    if(!points || !start || !end || !center || points.length<4 || !same(points[0],points[points.length-1])) return fail('明示された閉じた境界と有効な円弧座標が必要です。');
    const edges=points.slice(0,-1).map((p,i)=>({i,forward:same(p,start)&&same(points[i+1],end),reverse:same(p,end)&&same(points[i+1],start)})).filter(e=>e.forward||e.reverse);
    if(edges.length!==1) return fail('円弧の両端が単一の隣接境界辺と一致しません。');
    const result=interpolateArc(start,end,center,+m[4]*(m[5]==='NM'?1852:m[5]==='KM'?1000:1),'minor');
    if(result.status!=='resolved')return result;
    const e=edges[0],samples=e.forward?result.points!:[...result.points!].reverse();
    return completeBoundary(result,[...points.slice(0,e.i),...samples,...points.slice(e.i+2)]);
  }
  const inline=new RegExp(`(${CHAIN})\\s*[,;]?\\s*THEN (CLOCKWISE|COUNTERCLOCKWISE|ANTI-CLOCKWISE) ALONG ARC RADIUS (\\d+(?:\\.\\d+)?)\\s*(NM|KM|M) CENT(?:RE|ER)\\s*\\(\\s*(${COORD})\\s*\\) TO (${COORD}(?:\\s*-\\s*${COORD})*)(?=[ .;,]|$)`);
  const n=t.match(inline);
  if(n && /\bLATERAL LIMITS\b/.test(t.slice(0,n.index))) {
    if([...t.matchAll(new RegExp(COORD,'g'))].length!==[...n[0].matchAll(new RegExp(COORD,'g'))].length) return fail('円弧以外の座標列との関係が未確定です。');
    const before=chain(n[1]),after=chain(n[6]),center=coordinate(n[5]);
    if(!before || !after || !center || !same(before[0],after[after.length-1]))return fail('円弧境界の閉合が明示されていません。');
    const result=interpolateArc(before[before.length-1],after[0],center,+n[3]*(n[4]==='NM'?1852:n[4]==='KM'?1000:1),n[2]==='CLOCKWISE'?'clockwise':'counterclockwise');
    if(result.status!=='resolved')return result;
    return completeBoundary(result,[...before.slice(0,-1),...result.points!,...after.slice(1)]);
  }
  return fail('円弧の端点・中心・半径・方向を対応付けられないため区域は未確定です。');
}
