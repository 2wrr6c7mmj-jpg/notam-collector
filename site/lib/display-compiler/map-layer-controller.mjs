import {shapeMapStyle,shapeMapTooltip} from './map-shape-presentation.mjs';
export const mapNoticeKey = notice => `${notice.location}|${notice.id}|${notice.text}`;
const visible = (shape,approx,window) => (approx || !shape.approx) && (!window || shape.validityPeriods === undefined || shape.validityPeriods.some(p=>p.start<=window.end&&p.end>window.start));
/** Retain Leaflet layers for unchanged notices. Filtering only adds/removes its
 * delta; selection updates style, never reparses or rebuilds every geometry. */
export function createMapLayerController({L,layer,createTooltip}) {
 const records=new Map();let currentSelect=()=>{},lastOrder=[];
 function build(notice,shape,color,selected){
  if(!shape.points.length||shape.points.some(p=>!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>90||Math.abs(p[1])>180)||(shape.kind==='circle'&&(!Number.isFinite(shape.radius)||(shape.radius||0)<=0)))return null;
  const points=shape.points.map(p=>[...p]);
  for(let i=1;i<points.length;i++){while(points[i][1]-points[i-1][1]>180)points[i][1]-=360;while(points[i][1]-points[i-1][1]<-180)points[i][1]+=360;}
  const opts=shapeMapStyle(shape,{color,selected});
  const feature=shape.kind==='circle'?L.circle(points[0],{...opts,radius:shape.radius}):shape.kind==='polygon'?L.polygon(shape.holes?.length?[points,...shape.holes.map(ring=>ring.map(p=>{let lon=p[1];while(lon-points[0][1]>180)lon-=360;while(lon-points[0][1]<-180)lon+=360;return[p[0],lon];}))]:points,opts):shape.kind==='line'?L.polyline(points,opts):L.circleMarker(points[0],{...opts,radius:selected?7:5,fillOpacity:0.9});
  feature.on('click',()=>currentSelect(notice));
  const closing=shape.kind==='polygon'&&shape.inferredClose&&shape.points.length>=3?L.polyline([points.at(-1),points[0]],{color,weight:selected?4:2,dashArray:'7 6'}).on('click',()=>currentSelect(notice)):null;
  return {feature,closing};
 }
 function sync(items,{approx,activeId,onSelect,palette,itemLabel,timeWindow}){
  currentSelect=onSelect;
  // Selection identity can repeat across sources. Keep each occurrence, as
  // the original full renderer did, instead of silently collapsing duplicates.
  const occurrences=new Map();
  const entries=items.map(notice=>{const selectionKey=mapNoticeKey(notice),ordinal=occurrences.get(selectionKey)||0;occurrences.set(selectionKey,ordinal+1);return {notice,selectionKey,key:JSON.stringify([selectionKey,ordinal])};});
  const keys=new Set(entries.map(entry=>entry.key));let invalid=0,activeGroup=null,changed=false;
  for(const[key,record]of records)if(!keys.has(key)){layer.removeLayer(record.group);records.delete(key);changed=true;}
  for(const {notice,selectionKey,key} of entries){
   const selected=selectionKey===activeId,color=palette[notice.purpose]?.color||'#9bb4c9';
   let record=records.get(key);
   if(record&&record.notice!==notice){layer.removeLayer(record.group);records.delete(key);record=null;changed=true;}
   if(!record){record={notice,group:L.featureGroup(),shapes:new Map(),selected,color,itemLabel};records.set(key,record);changed=true;}
   const wanted=new Set();
   for(const[index,shape]of notice.shapes.entries()){
    if(!visible(shape,approx,timeWindow))continue;
    wanted.add(index);let entry=record.shapes.get(index);
    if(!record.shapes.has(index)){
     try{entry=build(notice,shape,color,selected);}catch{entry=null;}
     record.shapes.set(index,entry);changed=true;
     if(entry){entry.feature.bindTooltip(createTooltip(shapeMapTooltip(notice,shape,itemLabel)),{sticky:true,direction:'top'});entry.feature.addTo(record.group);entry.closing?.addTo(record.group);}
    }else if(entry){
     if(record.selected!==selected||record.color!==color){entry.feature.setStyle({...shapeMapStyle(shape,{color,selected}),...(shape.kind==='point'?{fillOpacity:0.9}:{})});if(shape.kind==='point')entry.feature.setRadius(selected?7:5);entry.closing?.setStyle({color,weight:selected?4:2,dashArray:'7 6'});}
     if(record.itemLabel!==itemLabel)entry.feature.setTooltipContent(createTooltip(shapeMapTooltip(notice,shape,itemLabel)));
    }
    if(!entry)invalid++;
   }
   for(const[index,entry]of record.shapes)if(!wanted.has(index)){if(entry){record.group.removeLayer(entry.feature);if(entry.closing)record.group.removeLayer(entry.closing);}record.shapes.delete(index);changed=true;}
   record.selected=selected;record.color=color;record.itemLabel=itemLabel;
   if(record.group.getLayers().length){if(!layer.hasLayer(record.group))record.group.addTo(layer);if(selected)activeGroup=record.group;}
   else if(layer.hasLayer(record.group))layer.removeLayer(record.group);
  }
  const order=entries.map(entry=>entry.key);
  // Preserve source stacking order when filters reintroduce earlier notices.
  if(changed||order.some((key,index)=>key!==lastOrder[index]))for(const key of order){
   const record=records.get(key);
   if(record)for(const[,entry]of [...record.shapes].sort((a,b)=>a[0]-b[0])){entry?.feature.bringToFront();entry?.closing?.bringToFront();}
  }
  lastOrder=order;
  return {invalid,activeGroup};
 }
 return {sync,clear(){layer.clearLayers();records.clear();lastOrder=[];}};
}
