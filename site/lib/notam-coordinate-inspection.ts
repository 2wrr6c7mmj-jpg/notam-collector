import {coordinates, coordinateWarnings, extractNoticeBody, type Notice, type Point} from './notam';

/** This measures parser output, not the completeness or authority of the source. */
export function inspectNoticeCoordinates(notice: Pick<Notice,'text'|'shapes'|'cancelled'>) {
  const body=extractNoticeBody(notice.text);
  const raw=coordinates(body);
  const unique=[...new Map(raw.map(point=>[point.join(','),point])).values()];
  const plotted=notice.shapes.filter(shape=>!shape.approx).flatMap(shape=>[...shape.points,...(shape.holes??[]).flat()]);
  const matches=(a:Point,b:Point)=>Math.abs(a[0]-b[0])<1e-7&&Math.abs(a[1]-b[1])<1e-7;
  const points=unique.map(point=>({point,plotted:plotted.some(p=>matches(p,point))}));
  return {
    points,
    warnings:coordinateWarnings(body),
    generatedVertexCount:notice.shapes.reduce((sum,shape)=>sum+shape.points.length+(shape.holes??[]).reduce((n,hole)=>n+hole.length,0),0),
    referencePointCount:points.filter(p=>!p.plotted).length,
    cancelled:!!notice.cancelled,
  };
}
