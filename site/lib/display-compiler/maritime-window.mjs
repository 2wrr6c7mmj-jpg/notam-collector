const bounded=p=>Number.isFinite(p?.start)&&Number.isFinite(p?.end)&&p.end>p.start;
const overlaps=(p,from,to)=>p.start<=to&&p.end>from;
/** Compare compiled activity and enclosing validity evidence without parsing source text. */
export function maritimeWindowStatus(n,from,to){
 const s=n.staticSchedule||{};
 if(s.cancelled||n.cancelled)return 'inactive';
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)return 'unknown';
 // A partial notice can still prove individual activity windows. Do not fill
 // their gaps or infer an envelope from a min/max of those windows.
 if(s.openEndedPeriods?.some(p=>Number.isFinite(p.start)&&p.end===null&&p.start<=to))return 'active';
 if(s.periods?.some(p=>bounded(p)&&overlaps(p,from,to)))return 'active';
 const validity=(s.validityPeriods||[]).filter(bounded);
 if(validity.some(p=>overlaps(p,from,to)))return 'validity';
 if(validity.length&&s.validityComplete===true)return 'inactive';
 return s.requiresReview||['partial','unknown'].includes(s.completeness)?'unknown':'inactive';
}
export function maritimeStartsWithin(n,now,hours){
 const s=n.staticSchedule||{};
 if(s.cancelled||n.cancelled||!Number.isFinite(now)||!Number.isFinite(hours)||hours<=0)return false;
 const current=maritimeWindowStatus(n,now,now);
 if(current==='active'||current==='validity')return false;
 const horizon=now+hours*3600000;
 return [...(s.periods||[]).filter(bounded),...(s.validityPeriods||[]).filter(bounded),...(s.openEndedPeriods||[]).filter(p=>Number.isFinite(p.start)&&p.end===null)].some(p=>p.start>now&&p.start<=horizon);
}
