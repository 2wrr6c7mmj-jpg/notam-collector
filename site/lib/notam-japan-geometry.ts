import {interpolateArc, type ArcPoint, type ArcResult} from './notam-arcs';
// QTE = true bearing: EUROCONTROL Digital NOTAM Appendix A (consulted 2026-10-03).
// https://ext.eurocontrol.int/aixm_confluence/display/DNOTAM/Appendix%2BA%2B-%2BAbbreviations%2Band%2Bacronyms
const R=Math.PI/180, EARTH=6371008.8;
function destination(c:ArcPoint,bearing:number,radius:number):ArcPoint {
  const a=c[0]*R,b=bearing*R,d=radius/EARTH;
  const lat=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(b));
  const lon=c[1]+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(lat))/R;
  return [lat/R,((lon+540)%360)-180];
}
/** Deliberately narrow: one center, one stated radius, exactly two true bearings,
 * ascending <180 degree sector. No wrap-around/sweep guessing or exclusions. */
export function parseExplicitTrueBearingSector(input:string,points:ArcPoint[]):ArcResult {
  const t=input.toUpperCase().replace(/\s+/g,' ').trim();
  if(!/FAN[- ]SHAPED/.test(t))return {status:'not-applicable',warnings:[]};
  const fail=():ArcResult=>({status:'unsupported',warnings:['扇形の中心・半径・真方位の対応が未確定です。推測で補完していません。']});
  if(points.length!==1 || /\b(?:EXC|EXCL|EXCLUDING|EXCLUDE|EXCEPT|OUTSIDE|MINUS|COAST|SHORE|ARC|MAGNETIC|QDR)\b/.test(t))return fail();
  const matches=[...t.matchAll(/FAN[- ]SHAPED AREA WITHIN (\d+(?:\.\d+)?)\s*(KM|NM|M) RADIUS OF (\d{6}(?:\.\d+)?[NS]\s*\d{7}(?:\.\d+)?[EW]) BTN QTE (\d{1,3}(?:\.\d+)?)DEG AND (\d{1,3}(?:\.\d+)?)DEG\b/g)];
  if(matches.length!==1 || [...t.matchAll(/\b(?:RADIUS|QTE)\b/g)].length!==2 || [...t.matchAll(/\d+(?:\.\d+)?DEG\b/g)].length!==2)return fail();
  const m=matches[0],a=+m[4],b=+m[5],radius=+m[1]*(m[2]==='KM'?1000:m[2]==='NM'?1852:1);
  if(a<0||a>=360||b<=a||b>=360||b-a>=180||radius<=0||radius>100000)return fail();
  const center=points[0];
  if(!center.every(Number.isFinite)||Math.abs(center[0])>85||Math.abs(center[1])>180)return fail();
  const first=destination(center,a,radius),last=destination(center,b,radius);
  const arc=interpolateArc(first,last,center,radius,'clockwise');
  if(arc.status!=='resolved'||!arc.points)return fail();
  const ring=[center,...arc.points,center];
  if(ring.some((p,i)=>i>0&&Math.abs(p[1]-ring[i-1][1])>180))return fail();
  return {...arc,points:ring,warnings:['明示された中心・半径・QTE（真方位）から扇形を球面補間した概略境界です。航法には使用できません。']};
}

/** A non-negative decimal pair followed by E unambiguously labels longitude.
 * Never suppress negative/E contradictions, invalid ranges, compact DMS tokens,
 * or malformed decimal components. */
export function normalizePositiveDecimalEastPair(input:string) {
  return input.replace(/(?<![\d.+-])(\+?\d{1,2}\.\d+)([ \t]*[,;][ \t]*|[ \t]+)(\+?\d{1,3}\.\d+)[ \t]*E(?![A-Z0-9])/g,
    (all,lat,sep,lon)=>+lat<=90&&+lon<=180 ? `${lat}${sep}${lon}` : all);
}

/** Prevent the general radius matcher from cherry-picking either half of a
 * contradictory published unit pair. No source-unit repair is attempted. */
export function hasConflictingRadiusUnits(input:string) {
  const scale:Record<string,number>={FT:0.3048,M:1,KM:1000,NM:1852};
  const matches=[...input.toUpperCase().matchAll(/\b(\d+(?:\.\d+)?)\s*(FT|KM|NM|M)\s*\/\s*(\d+(?:\.\d+)?)\s*(FT|KM|NM|M)\s+(?:RADIUS|RAD)\b/g)];
  return matches.some(m=>{const a=+m[1]*scale[m[2]],b=+m[3]*scale[m[4]];return Math.abs(a-b)>Math.max(1,Math.max(a,b)*0.02)});
}

/** Only the published three-layer balloon template with explicit local RMK
 * exclusions/inclusions. Do not weaken exclusion scope for arbitrary sections. */
export function splitExplicitBalloonAltitudeAreas(input:string):string[]|null {
  const t=input.toUpperCase();
  if(!/^MAX\s+\d+\s+HOT[- ]AIR\s+BALLOONS\s*:/.test(t.trim()) || !/ALT\/FLT\s+AREA\s*:/.test(t))return null;
  const parts=t.split(/(?=\(\d+\)AREA\s*:\s*BOUNDED\s+BY)/);
  if(parts.length!==4 || /\bEXC|\d{4,6}(?:\.\d+)?[NS]/.test(parts[0]))return null;
  const sections=parts.slice(1);
  if(!sections.every((s,i)=>s.startsWith(`(${i+1})AREA`) && [...s.matchAll(/\bALT\s*:\s*AT\s+OR\s+BLW\s+\d+FT\s+AMSL/g)].length===1))return null;
  if(!/RMK\s*:\s*EXC\s+FLW\s+AREA\s*\r?\n1\.RADIUS\s+\d+NM\s+CENTER/.test(sections[0]) || !/2\.BOUNDED\s+BY\s+FLW\s+POINTS/.test(sections[0]))return null;
  if(!/RMK\s*:\s*INCLUDE\s+AREA\s+RADIUS\s+\d+NM\s+CENTER/.test(sections[1]))return null;
  if(sections.slice(1).some(s=>/\b(?:EXC|EXCL|EXCLUDE|EXCLUDING|EXCEPT|OUTSIDE|MINUS)\b/.test(s)))return null;
  return sections;
}
