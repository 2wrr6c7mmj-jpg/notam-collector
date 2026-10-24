import polygonClipping from 'polygon-clipping';
type Point = [number, number]; // latitude, longitude
export type CorridorPolygon = {kind:'polygon';points:Point[];holes?:Point[][];interpolated:true;reconstructedCorridor:true;corridorHalfWidthMeters:number;sourceReference:string};
export type CorridorResult = {status:'resolved'|'unsupported';shapes:CorridorPolygon[];warnings:string[];halfWidthMeters?:number;centerline?:Point[]};
const R=6371008.8, D=Math.PI/180;
export const corridorDistance=(a:Point,b:Point)=>2*R*Math.asin(Math.min(1,Math.sqrt(Math.sin((b[0]-a[0])*D/2)**2+Math.cos(a[0]*D)*Math.cos(b[0]*D)*Math.sin((b[1]-a[1])*D/2)**2)));
export function corridorBearing(a:Point,b:Point){const p=a[0]*D,q=b[0]*D,l=(b[1]-a[1])*D;return Math.atan2(Math.sin(l)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(l))/D;}
export function corridorDestination(p:Point,bearing:number,meters:number):Point{
  const a=meters/R,b=bearing*D,lat=p[0]*D,lon=p[1]*D;
  const y=Math.asin(Math.sin(lat)*Math.cos(a)+Math.cos(lat)*Math.sin(a)*Math.cos(b));
  const x=lon+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(lat),Math.cos(a)-Math.sin(lat)*Math.sin(y));
  return [y/D,((x/D+540)%360)-180];
}
const same=(a:Point,b:Point)=>corridorDistance(a,b)<0.001;
const unsupported=(reason:string):CorridorResult=>({status:'unsupported',shapes:[],warnings:[reason]});
/** Spherical geodesic offsets (mean Earth radius), sampled at <=2km along a
 * segment and <=2 degrees at bend joins. Not a surveyed WGS84 ellipsoid outline.
 * Union prevents retraces/self-crossings from producing bow-ties or lost holes.
 * Open path endpoints are perpendicular, never silently extended by round caps.
 * These endpoint/join choices are display reconstruction, not legal boundaries.
 * Reject dateline/polar/global cases rather than union in an invalid projection.
 */
export function buildCorridor(points:Point[],halfWidthMeters:number):CorridorPolygon[]|null{
  if(!Number.isFinite(halfWidthMeters)||halfWidthMeters<=0||halfWidthMeters>100000||points.length<2||points.length>200)return null;
  if(points.some(p=>p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>80||Math.abs(p[1])>180))return null;
  const path=points.filter((p,i)=>!i||!same(p,points[i-1]));
  if(path.length<2)return null;
  const lon=path.map(p=>p[1]);if(Math.max(...lon)-Math.min(...lon)>40)return null;
  const polygons: number[][][][]=[];
  const append=(ring:Point[])=>{
    if(ring.some(p=>Math.abs(p[0])>81||Math.abs(p[1]-path[0][1])>40))throw Error('unsupported extent');
    const xy=ring.map(([lat,lon])=>[Math.round(lon*1e9)/1e9,Math.round(lat*1e9)/1e9]);xy.push([...xy[0]]);polygons.push([xy]);
  };
  try{
    let samples=0;const seenSegments=new Set<string>();
    for(let i=1;i<path.length;i++){
      // Canonicalize only segment computation, never the published route order.
      // Exact retraces must share identical sampled edges for robust union.
      const ends=[path[i-1],path[i]].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      const key=JSON.stringify(ends);if(seenSegments.has(key))continue;seenSegments.add(key);
      const [a,b]=ends,length=corridorDistance(a,b);
      if(length>1500000)return null;
      const n=Math.max(1,Math.ceil(length/2000));samples+=n;if(samples>5000)return null;
      const heading=corridorBearing(a,b),left:Point[]=[],right:Point[]=[];
      for(let j=0;j<=n;j++){
        const p=j===n?b:corridorDestination(a,heading,length*j/n);
        const tangent=j===n?corridorBearing(b,a)+180:corridorBearing(p,b);
        left.push(corridorDestination(p,tangent-90,halfWidthMeters));right.push(corridorDestination(p,tangent+90,halfWidthMeters));
      }
      append([...left,...right.reverse()]);
    }
    const closed=same(path[0],path[path.length-1]);
    // Original vertices only; interpolation vertices need no extra disks.
    for(let i=closed?0:1;i<path.length-1;i++)append(Array.from({length:180},(_,j)=>corridorDestination(path[i],j*2,halfWidthMeters)));
    const merged=polygonClipping.union(polygons[0] as polygonClipping.Polygon,...polygons.slice(1) as polygonClipping.Polygon[]);
    return merged.map(poly=>({kind:'polygon' as const,points:poly[0].map(([lon,lat])=>[lat,lon] as Point),
      ...(poly.length>1?{holes:poly.slice(1).map(r=>r.map(([lon,lat])=>[lat,lon] as Point))}:{}),interpolated:true as const,reconstructedCorridor:true as const,corridorHalfWidthMeters:halfWidthMeters,
      sourceReference:'公示中心線と左右幅から球面測地線で復元。折点は円弧接続、開いた経路の端部は直角で閉合（端部形状は原文未指定）。'}));
  }catch{return null;}
}

/** Input MUST be normalizeCoordinateText(block). The coordinate reader is
 * injected to share the application's validated DMS parsing, avoiding a cycle.
 * Strictly validate every gap; never skip a named fix and bridge its neighbours.
 */
export function parseExplicitCorridor(block:string,coordinates:(text:string)=>Point[]):CorridorResult{
  const width=[...block.matchAll(/(?:\b|(?<=WI))(\d+(?:\.\d+)?)\s*(NM|KM|M)\s+EITHER\s+SIDE\b/g)];
  if(width.length!==1)return unsupported('帯状区域の幅または区分が未確定のため、座標のみ表示します。');
  const prefix=block.slice(0,width[0].index!);
  if (prefix.trim() && !/(?:\bWI(?:THIN)?|\bAS\s+FLW|\bAREA)\s*:?\s*$/.test(prefix) && !/^\s*\(?\d+\)?[.)]\s*$/.test(prefix)) return unsupported('帯状区域の幅に範囲・符号・未対応の表記があるため、座標のみ表示します。');
  if(/\b(?:EXC|EXCL|EXCLUD(?:E|ES|ED|ING)|EXCEPT|OUTSIDE|MINUS|ARC|ARCS|CIRCLE|COAST|SHORE|RIVER|BOUNDARY|BDRY)\b/.test(block))return unsupported('帯状区域の除外・曲線・地物境界が未確定のため、区域を塗りつぶしていません。');
  const halfWidth=+width[0][1]*(width[0][2]==='NM'?1852:width[0][2]==='KM'?1000:1);
  let suffix=block.slice(width[0].index!+width[0][0].length);
  const introduction=suffix.match(/^\s+OF\s+(?:(?:A|THE)\s+)?(?:CENT(?:ER|RE)\s+)?LINE(?:\s+(?:JOINING|CONNECTING)(?:\s+(?:THE\s+)?POINTS?)?)?\s*[:.]?\s*/);
  if(!introduction)return unsupported('帯状区域の中心線の対応が未確定です。座標のみ表示します。');
  suffix=suffix.slice(introduction[0].length);
  // Feed occasionally interleaves F/G altitude fields inside a multipart path.
  // Remove ONLY the fully specified pair, not arbitrary text or named fixes.
  const altitude='(?:SFC|GND|UNL|FL\\s*\\d+|\\d+(?:\\.\\d+)?\\s*(?:M|FT)\\s*(?:AMSL|AGL))';
  suffix=suffix.replace(new RegExp('F\\)\\s*'+altitude+'\\s+G\\)\\s*'+altitude,'g'),' ');
  const pair=/(?<![A-Z0-9.])(?:\d{4,6}(?:\.\d+)?[NS]\s*[- /,;]*\s*\d{5,7}(?:\.\d+)?[EW]|\d{5,7}(?:\.\d+)?[EW]\s*[- /,;]*\s*\d{4,6}(?:\.\d+)?[NS])(?![A-Z0-9])/g;
  const hits=[...suffix.matchAll(pair)];
  if(hits.length<2)return unsupported('帯状区域の中心線に必要な座標が不足しています。区域を補完していません。');
  let previous=0;const points:Point[]=[];
  for(const hit of hits){
    const gap=suffix.slice(previous,hit.index!);
    if(!/^[\s,;:.-]*$/.test(gap))return unsupported('帯状区域の中心線に未解決の地点名・区切りがあります。地点を飛ばして接続せず、座標のみ表示します。');
    const p=coordinates(hit[0]);if(p.length!==1)return unsupported('帯状区域の中心線に不正な座標があります。座標のみ表示します。');
    points.push(p[0]);previous=hit.index!+hit[0].length;
  }
  const tail=suffix.slice(previous);
  // A dangling dash or named final fix is an incomplete route, not a cap.
  if(/^\s*-(?!\s*\d+(?:\.\d+)?\s*(?:M|FT)\b)/.test(tail)||/^\s*(?:TO|VIA)\b/.test(tail))return unsupported('帯状区域の中心線の終点が未確定です。座標のみ表示します。');
  const rest=tail.replace(/^[\s.]+/,'');
  if(rest&&!/^(?:\(|\d+(?:\.\d+)?\s*(?:M|FT)\b|SFC\b|GND\b|FL\s*\d|ATC\b|RMK\b|WT\b|FLT\b|CONTACT\b|F\)|G\)|TRAINING\s+FLT\b|AIRSPACE\s+CLSD\b)/.test(rest))return unsupported('帯状区域の中心線の後に未解決の地点名があります。座標のみ表示します。');
  const shapes=buildCorridor(points,halfWidth);
  if(!shapes?.length)return unsupported('帯状区域の測地線幅を安全に復元できないため、座標のみ表示します。');
  return {status:'resolved',shapes,halfWidthMeters:halfWidth,centerline:points,warnings:[`帯状区域を左右各${width[0][1]}${width[0][2]}（全幅${halfWidth*2}m）の球面測地線で復元。端部は直角、折点は円弧で補間しています。端部形状は原文未指定のため参考表示です。`]};
}
