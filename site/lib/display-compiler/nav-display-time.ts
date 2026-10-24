import {maritimeStatusLabel} from './listing-status.mjs';
import {maritimeWindowStatus,maritimeStartsWithin} from './maritime-window.mjs';
import type {Notice} from './notam';
import {maritimeTimeStatus} from './nav-time-status';
/** UI inclusion can use an explicit enclosing period without declaring activity. */
export function navDisplayStatus(n:Notice,from:number,to:number):'active'|'validity'|'inactive'|'unknown'|'stale'{
 if(n.sourceStale&&!n.cancelled)return 'stale';
 if(n.msilIdentity&&n.staticSchedule)return maritimeWindowStatus(n,from,to);
 if(n.cancelled)return 'inactive';
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)return 'unknown';
 const s=maritimeTimeStatus(n),overlap=(p:{start:number;end:number})=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start&&p.start<=to&&p.end>from;
 if(s.periods.some(overlap))return 'active';
 if(s.validityPeriods?.some(overlap))return 'validity';
 if(s.validityPeriods?.length&&s.validityComplete)return 'inactive';
 return s.requiresReview?'unknown':'inactive';
}
export function navDisplayStartsWithin(n:Notice,now:number,hours:number){
 if(n.sourceStale)return false;
 if(n.msilIdentity&&n.staticSchedule)return maritimeStartsWithin(n,now,hours);
 if(n.cancelled||!Number.isFinite(now)||!Number.isFinite(hours)||hours<=0||['active','validity'].includes(navDisplayStatus(n,now,now)))return false;
 const s=maritimeTimeStatus(n);return [...s.periods,...s.validityPeriods||[]].some(p=>p.start>now&&p.start<=now+hours*3600000&&p.end>p.start);
}

export function navDisplayNeedsReview(n:Notice,from:number,to=from){
 if(n.cancelled)return false;
 if(n.msilIdentity&&n.staticSchedule?.periodKnowledge==='primary-and-conditional'&&n.staticSchedule.periods.some(p=>p.end>p.start))return false;
 return navDisplayStatus(n,from,to)==='unknown';
}

export function navDisplayTimeSummary(n:Notice){
 const result=(n.msilIdentity||n.taiwanPdf)&&n.detail?{...n.detail,label:maritimeStatusLabel(n)||n.detail.label}:maritimeTimeStatus(n);
 return n.sourceStale?{...result,label:'保存分・要更新',details:['取得・照合時刻が古いため地図の区域を表示していません。確認済みの日程と原文は保持しています。',...result.details]}:result;
}
