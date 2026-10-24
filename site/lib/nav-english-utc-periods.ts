/** Bounded UTC maritime schedule families. No date-only bounds are manufactured. */
export type UtcPeriod = { start: number; end: number };
const DAY = 86400000;
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const M = '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)';
const normalize=(s:string)=>s.normalize('NFKC').toUpperCase().replace(/,/g,', ').replace(/\s+/g,' ').trim();
function stamp(year:number, month:number, digits:string) {
  const day=+digits.slice(0,2),hour=+digits.slice(2,4),minute=+digits.slice(4,6);
  if(!/^\d{6}$/.test(digits)||year<2000||year>2100||month<0||month>11||hour>23||minute>59)return null;
  const n=Date.UTC(year,month,day,hour,minute),d=new Date(n);
  return d.getUTCFullYear()===year&&d.getUTCMonth()===month&&d.getUTCDate()===day?n:null;
}
function nearbyYear(postedAt:number|null,month:number) {
  if(postedAt===null||!Number.isFinite(postedAt))return null;
  const p=new Date(postedAt);
  // Same-calendar-year only. Cross-year schedules need explicit year grammar.
  return Math.abs(p.getUTCMonth()-month)<=2?p.getUTCFullYear():null;
}
/** Recover only the unequivocal primary window; alternates and lifecycle stay uncertain. */
export function jcgPrimaryWithAlternates(text:string,postedAt:number|null) {
  const t=normalize(text),activity=t.split(/\bCANCEL THIS MSG\b/)[0];
  if(/\b(?:EXC|EXCL|EXCLUD(?:E|ED|ING)|EXCEPT|INTERMITTENT|UNTIL FURTHER)\b/.test(activity))return null;
  const re=new RegExp(`\\b(\\d{6})Z TO (\\d{6})Z ${M}, ALTERNATE (\\d{4})(?:Z)? TO (\\d{4})Z DAILY (\\d{2}) AND (\\d{2}) ${M}\\. (?:AREAS? BOUNDED BY)\\b`);
  const m=activity.match(re);if(!m)return null;
  // Exactly one primary and one alternate clause, never silently salvage unknown extra clocks.
  if((activity.match(/\bALTERNATE\b/g)||[]).length!==1||(activity.match(/\b\d{6}Z\b/g)||[]).length!==2)return null;
  const month=MONTHS.indexOf(m[3]),year=nearbyYear(postedAt,month);if(year===null)return null;
  const start=stamp(year,month,m[1]),end=stamp(year,month,m[2]);
  const alternateMonth=MONTHS.indexOf(m[8]);
  if(start===null||end===null||end<=start||end-start>31*DAY||nearbyYear(postedAt,alternateMonth)!==year)return null;
  const alternatives=[m[6],m[7]].map(day=>({start:stamp(year,alternateMonth,day+m[4]),end:stamp(year,alternateMonth,day+m[5])}));
  if(alternatives.some(p=>p.start===null||p.end===null||p.end<=p.start!))return null;
  const cancel=t.match(new RegExp(`\\bCANCEL THIS MSG (\\d{6})Z ${M}\\.`));
  const cancelAt=cancel?stamp(year,MONTHS.indexOf(cancel[2]),cancel[1]):null;
  const conflict=cancelAt!==null&&alternatives.some(p=>cancelAt<p.end!);
  return {start,end,validityPeriods:[{start,end}],timeUncertain:true,
    warnings:['主日程の明示UTC区間のみ解析。ALTERNATEの予備日は実施条件未確認のため有効区間に含めていません。',...(conflict?['取消予定時刻が予備日より前です。原文の日程と取消の整合を確認してください。']:[])],
    alternateEvidence:alternatives.map(p=>({start:p.start!,end:p.end!,conditional:true})),cancelAt};
}
/** Bounded CN English family; overnight final-date semantics remain unresolved. */
export function englishUtcMaritimeAnalysis(text:string,postedAt:number|null):{periods:UtcPeriod[];timeUncertain:boolean;warnings:string[]} {
  const empty={periods:[] as UtcPeriod[],timeUncertain:true,warnings:[] as string[]};
  const t=normalize(text);
  if(/\b(?:ALTERNATE|EXC|EXCL|EXCLUD(?:E|ED|ING)|EXCEPT|INTERMITTENT|CANCEL|UNTIL FURTHER|WEEKDAYS?)\b/.test(t))return empty;
  // FROM after geometry is required; all schedule text must match before the terminating period.
  const m=t.match(new RegExp(`\\bFROM (\\d{6})UTC TO (\\d{6})UTC ${M},? AND (\\d{4})UTC TO (\\d{4})UTC DAILY FROM (\\d{2}) ${M} TO (\\d{2}) ${M}\\.(?: WIDE BERTH REQUESTED\\.)?(?: [A-Z ]+\\.)?$`));
  if(!m)return empty;
  const month=MONTHS.indexOf(m[3]),year=nearbyYear(postedAt,month);if(year===null)return empty;
  const a=stamp(year,month,m[1]),b=stamp(year,month,m[2]);
  const firstMonth=MONTHS.indexOf(m[7]),lastMonth=MONTHS.indexOf(m[9]);
  if(nearbyYear(postedAt,firstMonth)!==year||nearbyYear(postedAt,lastMonth)!==year)return empty;
  const first=stamp(year,firstMonth,m[6]+'0000'),last=stamp(year,lastMonth,m[8]+'0000');
  const sh=+m[4].slice(0,2),sm=+m[4].slice(2),eh=+m[5].slice(0,2),em=+m[5].slice(2);
  if(a===null||b===null||b<=a||first===null||last===null||last<first||last-first>93*DAY||sh>23||eh>23||sm>59||em>59||m[4]===m[5])return empty;
  const periods=[{start:a,end:b}];
  // DAILY FROM date TO date does not say which date an overnight ending belongs to.
  // The bilingual ZJ364/26 / 浙航警888/26 corpus proves an extra final-night risk.
  // Preserve only the independent precise primary; never manufacture the final night.
  if(eh*60+em<sh*60+sm)return {periods,timeUncertain:true,warnings:['主日程の明示UTC区間のみ解析。日跨ぎのDAILY FROM日程は最終日への対応が未確定です。同一事案の中国語原文と照合してください。']};
  for(let day=first;day<=last;day+=DAY){const start=day+(sh*60+sm)*60000;let end=day+(eh*60+em)*60000;if(end<start)end+=DAY;periods.push({start,end});}
  return {periods:[...new Map(periods.map(p=>[`${p.start}/${p.end}`,p])).values()].sort((x,y)=>x.start-y.start),timeUncertain:false,warnings:[]};
}

export function englishUtcMaritimePeriods(text:string,postedAt:number|null):UtcPeriod[] {
  return englishUtcMaritimeAnalysis(text,postedAt).periods;
}
