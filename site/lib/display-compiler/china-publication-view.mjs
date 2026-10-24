const DAY=86400000;
function publicationClass(n,now){
 if(n.publicationPrecision==='instant'&&Number.isFinite(n.issued))return n.issued>now?'unverified':n.issued>=now-7*DAY?'selected':'outside';
 const date=n.publicationDate||n.publicationRaw?.slice(0,10),day=date&&/^\d{4}-\d{2}-\d{2}$/.test(date)?Date.parse(date+'T00:00:00Z'):NaN;
 if(Number.isFinite(day)&&new Date(day).toISOString().slice(0,10)===date){const lo=day-14*3600000,hi=day+DAY+14*3600000;if(hi<=now-7*DAY)return 'outside';if(lo>=now-7*DAY&&hi<=now)return 'selected';}
 return 'unverified';
}
export function validateChinaView(maritime){
 const v=maritime?.chinaPublicationView;if(!v)return;
 const check=x=>{if(!x)throw Error('Invalid China publication view; previous snapshot retained');};
 check(v.schemaVersion===1&&v.days===7&&Number.isSafeInteger(v.to)&&v.from===v.to-7*DAY&&v.startInclusive===true&&v.endInclusive===true&&v.basis==='publication-timestamp-or-source-calendar'&&v.coverage==='partial'&&v.linkGraphComplete===false&&typeof v.scopeNotice==='string');
 const items=maritime.items.filter(n=>(n.sourceCountry||'CN')==='CN'),keys=new Set(items.map(n=>n.chinaOriginalId));
 check(v.rawCount===items.length&&keys.size===items.length&&[...keys].every(k=>typeof k==='string'&&/^[a-f0-9]{64}$/.test(k)));
 check(Array.isArray(v.selectedKeys)&&Array.isArray(v.unverifiedKeys));
 const selected=new Set(v.selectedKeys),unverified=new Set(v.unverifiedKeys);
 check(selected.size===v.selectedKeys.length&&unverified.size===v.unverifiedKeys.length&&[...selected,...unverified].every(k=>keys.has(k))&&[...selected].every(k=>!unverified.has(k)));
 for(const n of items){const kind=publicationClass(n,v.to);check(selected.has(n.chinaOriginalId)===(kind==='selected')&&unverified.has(n.chinaOriginalId)===(kind==='unverified'));}
 check(v.outsideWindowCount===items.length-selected.size-unverified.size);
 const sources=maritime.sources.filter(s=>(s.country||'CN')==='CN');
 check(Array.isArray(v.sources)&&v.sources.length===sources.length&&new Set(v.sources.map(s=>s.id)).size===sources.length);
 for(const s of sources){const r=v.sources.find(r=>r.id===s.id);check(r&&r.state===s.state&&r.rawCount===s.count&&r.fetchedAt===s.fetchedAt&&r.checkedAt===s.checkedAt&&r.complete===false&&typeof r.stale==='boolean'&&typeof r.blocked==='boolean');}
}
export function projectChinaView(items,maritime){
 const v=maritime?.chinaPublicationView;if(!v)return items;
 const selected=new Set(v.selectedKeys);
 return items.filter(n=>(n.sourceCountry||'CN')!=='CN'||selected.has(n.chinaOriginalId));
}
export function unverifiedChinaItems(maritime){
 const keys=new Set(maritime?.chinaPublicationView?.unverifiedKeys||[]);
 return (maritime?.items||[]).filter(n=>keys.has(n.chinaOriginalId));
}

