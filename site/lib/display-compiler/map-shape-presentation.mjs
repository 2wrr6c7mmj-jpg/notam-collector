export function shapeMapStyle(shape,{color,selected}) {
  // Leaflet can fill an open polyline when fill is explicitly enabled. Routes
  // must remain strokes; only separately defined areas may receive a fill.
  const fill=shape.kind!=='line'&&!shape.partialBoundary;
  return {color,weight:selected?4:2,fill,fillOpacity:fill?(selected?0.32:0.16):0,opacity:selected?1:0.86,dashArray:shape.approx||shape.interpolated||shape.partialBoundary||shape.referenceBoundary||shape.coastlineApproximated?'5 6':undefined};
}
export function shapeMapTooltip(notice,shape,itemLabel) {
  return `${notice.id||itemLabel} · ${notice.location}${shape.sourceReference?' · '+shape.sourceReference:''}${shape.partialBoundary&&!shape.qReference?' · 部分境界（全範囲未確定・外側も対象外とは判断できません）':''}`;
}
