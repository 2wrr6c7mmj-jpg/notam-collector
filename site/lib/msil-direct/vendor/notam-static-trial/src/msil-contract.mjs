// Immutable acquisition evidence. Derived timed records are validated separately.
export function validateMsilSupplement(value){
 if(value===undefined)return;
 const check=(v)=>{if(!v)throw Error('Invalid MSIL supplemental snapshot');};
 check(value?.schemaVersion===1&&value.kind==='msil-trial-supplement'&&Array.isArray(value.items)&&value.items.length<=10000&&value.warningCount===value.items.length&&['ok','error'].includes(value.refreshState));
 if(!value.items.length){check(value.refreshState==='error');return;}
 check(value.activity==='unknown'&&value.cancellation==='unknown');
 check(value.acquisition?.transportComplete===true&&value.acquisition?.consistentSnapshot===false&&value.acquisition?.fullWarningCoverage===false&&Number.isFinite(Date.parse(value.acquisition.completedAt)));
 check(Array.isArray(value.quarantine)&&value.quarantine.every(q=>q.mapIncluded===false)&&value.receivedFeatures===value.acceptedFeatures+value.quarantine.length);
 const ids=new Set();for(const item of value.items){
  check(typeof item.identity==='string'&&!ids.has(item.identity));ids.add(item.identity);
  check(typeof item.name==='string'&&typeof item.text==='string'&&Array.isArray(item.sourceLinks)&&Array.isArray(item.shapes)&&Array.isArray(item.geometries));
  check(item.temporal?.activity==='unknown'&&item.temporal?.cancellation==='unknown'&&item.temporal?.periods===null&&item.temporal?.publicationInstant===null&&item.topic?.activeAtTime===null);
 }
}
