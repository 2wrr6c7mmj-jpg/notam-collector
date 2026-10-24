import polygonClipping from 'polygon-clipping';
import { JAPAN_NOTAM_EXCLUSION_ZONES } from './japan-notam-exclusion-zones';
import { notamFields } from './notam-fields';
import type { Point, Shape } from './notam';

/** One bounded, source-backed reference operation. No guessed airport buffers.
 * GSI is display geometry, not current-AIP certification. Only an exclusion
 * covering the entire NOTAM vertical band may be cut from the 2D polygon.
 */
export function applyPublishedExclusion(text: string, block: string, outline: Shape[]): Shape[] | null {
 const upper=text.toUpperCase();
 if (!/\bEXC\s+RJSC\s+INFORMATION\s+ZONE\b/.test(block)) return null;
 const remaining=upper.replace(/\bEXC\s+RJSC\s+INFORMATION\s+ZONE\b/g,'');
 if (/\b(?:EXC|EXCL|EXCLUD\w*|EXCEPT|OUTSIDE|MINUS|ARC|COASTLINE|SHORE|RIVER)\b/.test(remaining)) return null;
 const fields=notamFields(upper);
 const top=fields.G?.match(/^(\d+(?:\.\d+)?)\s*FT\s+AMSL$/);
 const zone=JAPAN_NOTAM_EXCLUSION_ZONES.RJSC;
 if (!/^(?:SFC|GND)$/.test(fields.F??'') || !top || +top[1]>zone.upperFtAmsl || +top[1]<=0) return null;
 if(outline.length!==1 || outline[0].kind!=='line')return null;
 const p=outline[0].points;
 if(p.length<4 || p[0][0]!==p.at(-1)![0] || p[0][1]!==p.at(-1)![1])return null;
 const source=p.map(([lat,lon])=>[lon,lat] as [number,number]);
 const clip=zone.points.map(([lat,lon])=>[lon,lat] as [number,number]);
 try {
  const result=polygonClipping.difference([source],[clip]);
  if(!result.length || result.some(polygon=>polygon.some(ring=>ring.length<4 || ring.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))))return null;
  return result.map(polygon=>({kind:'polygon',points:polygon[0].map(([lon,lat])=>[lat,lon] as Point),holes:polygon.slice(1).map(ring=>ring.map(([lon,lat])=>[lat,lon] as Point)),referenceBoundary:true,provenance:'text'}));
 }catch{return null;}
}
