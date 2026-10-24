import {memoizeNoticeQuery} from './ui-performance.mjs';
import {normalizeNotamScheduleSyntax} from "./notam-schedule-normalize";
import {bodyActivationTimingIssue,supportedBodySchedule} from "./notam-body-timing";
import {notamFields} from "./notam-fields";
/** Deterministic NOTAM schedule subset. UTC throughout; never evaluates unsupported syntax as active. */
export type SchedulableNotice = { text: string; start: number | null; end: number | null; permanent?: boolean; cancelled?: boolean; lifecycleUncertain?: boolean };
export type ScheduleDiagnostic = { status: 'supported' | 'unsupported' | 'continuous'; raw: string; reason?: string };
type Rule = { year?: number; month?: number; days?: number[]; weekdays?: number[]; times: [number, number][] };
const DAY = 86400000;
const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const WEEK = 'SUN MON TUE WED THU FRI SAT'.split(' ');
export {notamFields} from "./notam-fields";
export function noticeHeader(text: string) {
  const header = text.split(/(?:^|\s)[QAB]\)/)[0];
  const m = header.match(/\b([A-Z]\d{4}\/\d{2})\s+NOTAM([NRC])(?:\s+([A-Z]\d{4}\/\d{2}))?/i);
  return { kind: m?.[2]?.toUpperCase() ?? 'unknown', id: m?.[1], reference: m?.[3], raw: m?.[0] ?? header.trim() };
}
function clock(raw: string, end: boolean): number | null {
  if (raw === '2400') return end ? 1440 : null;
  const h = Number(raw.slice(0, 2)), m = Number(raw.slice(2));
  return h < 24 && m < 60 ? h * 60 + m : null;
}
function list(raw: string, names?: string[]): number[] | null {
  const result: number[] = [];
  for (const token of raw.trim().split(/\s+/)) {
    const pieces = token.split('-');
    if (pieces.length > 2) return null;
    const values = pieces.map(p => names ? names.indexOf(p) : /^\d{2}$/.test(p) ? +p : -1);
    if (values.some(v => names ? v < 0 : v < 1 || v > 31)) return null;
    if (values.length === 1) result.push(values[0]);
    else {
      const [a, b] = values;
      if (!names && b < a) return null;
      for (let i = a; ; i = names ? (i + 1) % 7 : i + 1) { result.push(i); if (i === b) break; }
    }
  }
  return [...new Set(result)];
}
/** Explicit month changes within a single, bounded calendar year.
 * A day following a month/range inherits that month. Never treat a month
 * range as a continuous activity interval: each selected date owns its clocks.
 * Year-crossing or omitted initial months stay unsupported rather than guessed.
 */
function explicitMonthDates(selector:string,n:SchedulableNotice):{year:number;month:number;days:number[]}[]|null {
  if(n.start===null||n.end===null||!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.end<=n.start)return null;
  const year=new Date(n.start).getUTCFullYear();
  if(new Date(n.end-1).getUTCFullYear()!==year||n.end-n.start>366*DAY)return null;
  const tokens=selector.match(/\b[A-Z]{3}\b|\b\d{2}\b|-/g)||[];
  if(tokens.join('')!==selector.replace(/\s+/g,'')||!MONTHS.includes(tokens[0] || ''))return null;
  let i=0,month:number|undefined;
  const dates=new Map<number,Set<number>>();
  const valid=(m:number,d:number)=>d>=1&&d<=new Date(Date.UTC(year,m+1,0)).getUTCDate();
  const add=(m:number,d:number)=>{if(!dates.has(m))dates.set(m,new Set());dates.get(m)!.add(d);};
  while(i<tokens.length){
    if(MONTHS.includes(tokens[i])){const next=MONTHS.indexOf(tokens[i++]);if(month!==undefined&&next<month)return null;month=next;}
    if(month===undefined||!/^\d{2}$/.test(tokens[i]||''))return null;
    const first=+tokens[i++];if(!valid(month,first))return null;
    let endMonth=month,last=first;
    if(tokens[i]==='-'){
      i++;
      if(MONTHS.includes(tokens[i]))endMonth=MONTHS.indexOf(tokens[i++]);
      if(!/^\d{2}$/.test(tokens[i]||''))return null;
      last=+tokens[i++];
      if(!valid(endMonth,last)||endMonth<month||endMonth===month&&last<first)return null;
    }
    for(let day=Date.UTC(year,month,first),end=Date.UTC(year,endMonth,last);day<=end;day+=DAY){const date=new Date(day);add(date.getUTCMonth(),date.getUTCDate());}
    month=endMonth;
  }
  return [...dates].map(([month,days])=>({year,month,days:[...days].sort((a,b)=>a-b)}));
}
/** Resolve an omitted initial month only when the entire selector admits one
 * calendar assignment inside B/C. An earlier comma group may prove inheritance.
 * Multiple candidates (including otherwise plausible B-month guesses) fail closed.
 */
function resolvedMonthDates(selector:string,n:SchedulableNotice,inherited?:number){
  if(/^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/.test(selector))return explicitMonthDates(selector,n);
  if(inherited!==undefined)return explicitMonthDates(`${MONTHS[inherited]} ${selector}`,n);
  if(n.start===null||n.end===null)return null;
  const earliest=Math.floor(n.start/DAY)*DAY-DAY;
  const first=new Date(earliest),last=new Date(n.end-1);
  if(first.getUTCFullYear()!==last.getUTCFullYear())return null;
  const candidates=[];
  for(let month=first.getUTCMonth();month<=last.getUTCMonth();month++){
    const groups=explicitMonthDates(`${MONTHS[month]} ${selector}`,n);
    if(groups&&groups.every(g=>g.days.every(d=>{const t=Date.UTC(g.year,g.month,d);return t>=earliest&&t<=Math.floor((n.end!-1)/DAY)*DAY;})))candidates.push(groups);
  }
  return candidates.length===1?candidates[0]:null;
}
/** Require exact, calendar-valid published B/C, consistent with retained bounds.
 * A token merely resembling a date, or unrelated provider metadata, is not proof.
 */
export function hasKnownNotamValidity(n:SchedulableNotice):boolean {
  const fields=notamFields(n.text);
  if(n.lifecycleUncertain||['B','C'].some(key=>/\[DUPLICATE/.test(fields[key]||'')))return false;
  const clockDate=(raw:string|undefined)=>{
    const m=raw?.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);if(!m)return null;
    const [y,mo,d,h,mi]=m.slice(1).map(Number),t=Date.UTC(2000+y,mo-1,d,h,mi),date=new Date(t);
    return date.getUTCFullYear()===2000+y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d&&h<24&&mi<60?t:null;
  };
  const day=(raw:string|undefined)=>{const m=raw?.match(/^(20\d{2})-?(\d{2})-?(\d{2})(?:\s+UTC)?$/i);if(!m)return null;const [y,mo,d]=m.slice(1).map(Number),t=Date.UTC(y,mo-1,d),date=new Date(t);return date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d?t:null;};
  const dateStart=day(fields.B),dateEnd=day(fields.C);
  if(dateStart!==null&&dateEnd!==null)return !n.permanent&&dateEnd>=dateStart&&n.start===dateStart&&n.end===dateEnd+DAY;
  const start=clockDate(fields.B),rawEnd=fields.C?.match(/^(\d{10})(?:\s*EST)?$/i)?.[1],end=clockDate(rawEnd);
  if(start===null||n.start!==start)return false;
  if(fields.C?.toUpperCase()==='PERM')return n.permanent===true;
  return !n.permanent&&end!==null&&end>start&&n.end===end;
}
function outsideKnownValidity(n:SchedulableNotice,from:number,to:number):boolean {
  if(!hasKnownNotamValidity(n))return false;
  return to<n.start!||!n.permanent&&n.end!==null&&from>=n.end&&!/\d{10}\s*EST\b/i.test(notamFields(n.text).C??'');
}
function parse(n: SchedulableNotice,override?:string): { diagnostic: ScheduleDiagnostic; rules: Rule[]; periods?:{start:number;end:number}[] } {
  const raw = override ?? notamFields(n.text).D ?? '';
  const fail = (reason: string) => ({ diagnostic: { status: 'unsupported' as const, raw, reason }, rules: [] });
  if (!raw) return { diagnostic: { status: 'continuous', raw }, rules: [] };
  let text = raw.toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (/\b(?:EXC|EXCEPT|SR|SS|HJ|HN|HOL|LOCAL|LT|UTC[+-])\b/.test(text)) return fail('例外・日出日没・休日・現地時間を含むため自動判定対象外');
  text=normalizeNotamScheduleSyntax(text);
  let inheritedMonth: number | undefined, inheritedYear: number | undefined;
  const rules: Rule[] = [], periods:{start:number;end:number}[]=[];
  // Date groups must be comma-separated; rejecting otherwise is intentional.
  for (const part of text.split(',').map(p => p.trim())) {
    // DD HHMM-DD HHMM is one continuous interval, never a daily clock pair.
    const span=part.match(/^(?:([A-Z]{3})\s+)?(\d{2})\s+(\d{4})-(?:([A-Z]{3})\s+)?(\d{2})\s+(\d{4})$/);
    if(span){
      if(n.start===null||n.end===null||!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.end<=n.start)return fail('連続区間の年月を有効期間から確定できません');
      const first=new Date(n.start),last=new Date(n.end-1),year=first.getUTCFullYear();
      if(year!==last.getUTCFullYear()||n.end-n.start>366*DAY)return fail('年をまたぐ連続区間は自動判定対象外');
      const month=span[1]?MONTHS.indexOf(span[1]):inheritedMonth??(first.getUTCMonth()===last.getUTCMonth()?first.getUTCMonth():-1);
      const endMonth=span[4]?MONTHS.indexOf(span[4]):month;
      const day=+span[2],endDay=+span[5],a=clock(span[3],false),b=clock(span[6],true);
      const valid=(m:number,d:number)=>m>=0&&d>=1&&d<=new Date(Date.UTC(year,m+1,0)).getUTCDate();
      if(!valid(month,day)||!valid(endMonth,endDay)||a===null||b===null)return fail('連続区間の日付・時刻または月を確定できません');
      const start=Date.UTC(year,month,day)+a*60000,end=Date.UTC(year,endMonth,endDay)+b*60000;
      if(end<=start)return fail('連続区間の開始・終了が逆転または同一です');
      periods.push({start,end});inheritedMonth=endMonth;inheritedYear=year;continue;
    }
    const firstTime = part.search(/\b(?:\d{4}-\d{4}|H24)\b/);
    if (firstTime < 0) return fail('時間帯の書式を解析できません');
    let selector = part.slice(0, firstTime).trim();
    const timeText = part.slice(firstTime).trim();
    if (!/^(?:H24|\d{4}-\d{4})(?:\s+(?:H24|\d{4}-\d{4}))*$/.test(timeText)) return fail('複数日を連続して跨ぐ時間帯、または未対応の時間表記');
    const times: [number, number][] = [];
    for (const token of timeText.split(/\s+/)) {
      if (token === 'H24') { times.push([0, 1440]); continue; }
      const [a, b] = token.split('-'); const start = clock(a, false), end = clock(b, true);
      if (start === null || end === null || start === end) return fail('時刻が範囲外、または開始と終了が同一です');
      times.push([start, end <= start ? end + 1440 : end]);
    }
    const rule: Rule = { times };
    if (!selector || selector === 'DAILY') { rules.push(rule); continue; }
    if((selector.match(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/g)||[]).length>1||/^[0-9].*\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/.test(selector)){
      const groups=resolvedMonthDates(selector,n,inheritedMonth);
      if(!groups)return fail('月をまたぐ日付の書式または年を確定できません');
      rules.push(...groups.map(group=>({...group,times})));
      inheritedMonth=groups[groups.length-1].month;inheritedYear=groups[groups.length-1].year;
      continue;
    }
    const month = selector.match(/^([A-Z]{3})\s+/);
    if (month && MONTHS.includes(month[1])) { inheritedMonth = MONTHS.indexOf(month[1]); selector = selector.slice(month[0].length); }
    if (/^(?:SUN|MON|TUE|WED|THU|FRI|SAT)(?:\b|-)/.test(selector)) {
      const days = list(selector, WEEK); if (!days) return fail('曜日の書式を解析できません');
      rule.weekdays = days;
      // An explicitly named month scopes weekdays as well as day numbers.
      if(month&&MONTHS.includes(month[1]))rule.month=MONTHS.indexOf(month[1]);
    } else {
      const days = list(selector); if (!days) return fail('日付の書式を解析できません');
      let monthNumber = inheritedMonth;
      if (monthNumber === undefined) {
        if (n.start === null || n.end === null) return fail('月が省略され、有効期間から月を確定できません');
        const a = new Date(n.start), b = new Date(n.end - 1);
        if (a.getUTCFullYear() !== b.getUTCFullYear() || a.getUTCMonth() !== b.getUTCMonth()) {
          const groups=resolvedMonthDates(selector,n);
          if(!groups)return fail('月を省略した日付が複数月にまたがり曖昧です');
          rules.push(...groups.map(group=>({...group,times})));
          inheritedMonth=groups[groups.length-1].month;inheritedYear=groups[groups.length-1].year;
          continue;
        }
        const previousDay=Math.floor(n.start/DAY)*DAY-DAY,previousDate=new Date(previousDay);
        if(a.getUTCDate()===1&&days.includes(previousDate.getUTCDate())&&times.some(([,end])=>end>1440&&previousDay+end*60000>n.start!))return fail('月省略の日跨ぎが前月に属する可能性を除外できません');
        monthNumber = a.getUTCMonth();
      }
      if (n.start === null || n.end === null || n.end - n.start > 366 * DAY) return fail('日付指定の年を確定できません');
      // Simple selectors need the same real-calendar check as cross-month ones.
      // Never use an impossible D day to exclude a known B/C display period.
      const years=[...new Set([new Date(n.start).getUTCFullYear(),new Date(n.end-1).getUTCFullYear()])];
      if(days.some(day=>!years.some(year=>day<=new Date(Date.UTC(year,monthNumber!+1,0)).getUTCDate())))return fail('D欄の日付が暦に存在しません');
      rule.month = monthNumber; rule.days = days;if(inheritedYear!==undefined)rule.year=inheritedYear;
    }
    rules.push(rule);
  }
  // A literal month/day belongs to its published calendar context, not an
  // arbitrary prior-year overnight carry. Keep proved years on mixed forms.
  if(n.start!==null&&n.end!==null&&Number.isFinite(n.start)&&Number.isFinite(n.end))for(const rule of rules){
    if(rule.month===undefined)continue;
    if(rule.year===undefined){
      const firstYear=new Date(n.start).getUTCFullYear(),lastYear=new Date(n.end-1).getUTCFullYear();
      if(lastYear-firstYear>1)return fail('D欄の月指定の年を一意に確定できません');
      const overlapsYear=(year:number)=>{
        const lastDay=new Date(Date.UTC(year,rule.month!+1,0)).getUTCDate();
        for(const day of rule.days||Array.from({length:lastDay},(_,i)=>i+1)){
          if(day>lastDay)continue;
          const date=Date.UTC(year,rule.month!,day);
          if(rule.weekdays&&!rule.weekdays.includes(new Date(date).getUTCDay()))continue;
          if(rule.times.some(([a,b])=>date+a*60000<n.end!&&date+b*60000>n.start!))return true;
        }return false;
      };
      // Prefer dates in B/C's named years. A prior-year overnight carry is
      // allowed only when it is the sole overlapping calendar assignment.
      const contextual=[...new Set([firstYear,lastYear])],overlapping=contextual.filter(overlapsYear);
      const years=overlapping.length?overlapping:overlapsYear(firstYear-1)?[firstYear-1]:firstYear===lastYear?[firstYear]:contextual.filter(year=>Date.UTC(year,rule.month!,1)<n.end!&&Date.UTC(year,rule.month!+1,1)>n.start!);
      if(years.length!==1)return fail('D欄の月指定の年を一意に確定できません');
      rule.year=years[0];
    }
    if(rule.days?.some(day=>day>new Date(Date.UTC(rule.year!,rule.month!+1,0)).getUTCDate()))return fail('D欄の日付が暦に存在しません');
  }
  return { diagnostic: { status: 'supported', raw }, rules, ...(periods.length?{periods}:{}) };
}
function scheduleWindows(n:SchedulableNotice,parsed:ReturnType<typeof parse>){
 if(n.start===null||n.end===null)return [];
 if(parsed.diagnostic.status==='continuous')return [{start:n.start,end:n.end}];
 const out:{start:number;end:number}[]=(parsed.periods||[]).map(p=>({start:Math.max(n.start!,p.start),end:Math.min(n.end!,p.end)})).filter(p=>p.end>p.start);
 for(let day=Math.floor(n.start/DAY)*DAY-DAY;day<n.end;day+=DAY){const d=new Date(day);for(const rule of parsed.rules){
  if(rule.year!==undefined&&rule.year!==d.getUTCFullYear()||rule.month!==undefined&&rule.month!==d.getUTCMonth()||rule.days&&!rule.days.includes(d.getUTCDate())||rule.weekdays&&!rule.weekdays.includes(d.getUTCDay()))continue;
  for(const[a,b]of rule.times){const start=Math.max(n.start,day+a*60000),end=Math.min(n.end,day+b*60000);if(end>start)out.push({start,end});}
 }}return out;
}
function bodySchedule(n:SchedulableNotice){
 const fields=notamFields(n.text),issue=bodyActivationTimingIssue(fields);if(!issue)return null;
 const raw=supportedBodySchedule(fields),d=parse(n),e=raw?parse(n,raw):null;
 if(!raw||!e||e.diagnostic.status==='unsupported'||d.diagnostic.status==='unsupported'||n.permanent||n.start===null||n.end===null||n.end-n.start>370*DAY)return {diagnostic:{status:'unsupported' as const,raw:issue.evidence,reason:issue.reason},periods:[]};
 const intervals=scheduleWindows(n,d),body=scheduleWindows(n,e),periods:{start:number;end:number}[]=[];
 for(const a of intervals)for(const b of body){const start=Math.max(a.start,b.start),end=Math.min(a.end,b.end);if(end>start)periods.push({start,end});}
 return {diagnostic:{status:'supported' as const,raw:issue.evidence},periods:[...new Map(periods.map(p=>[p.start+'/'+p.end,p])).values()].sort((a,b)=>a.start-b.start)};
}
export function scheduleDiagnostics(n: SchedulableNotice): ScheduleDiagnostic {
  const fields = notamFields(n.text);
  if(n.lifecycleUncertain)return {status:"unsupported",raw:fields.D || "",reason:"取消し・置換の発出時刻を確定できません"};
  if (["B","C","D"].some(key=>/\[DUPLICATE/.test(fields[key] || ""))) return {status:"unsupported",raw:fields.D || "",reason:"日時欄が重複しています。どの区域・期間に対応するか確定できません"};
  if (n.start === null || !Number.isFinite(n.start) || (!n.permanent && (n.end === null || !Number.isFinite(n.end)))) return { status: 'unsupported', raw: fields.D ?? '', reason: '有効期間B/Cを確定できません' };
  if (n.end !== null && n.end <= n.start) return { status: 'unsupported', raw: fields.D ?? '', reason: '有効期間の開始・終了が逆転または同一です' };
  if(!n.cancelled&&noticeHeader(n.text).kind!=='C'&&!hasKnownNotamValidity(n))return {status:'unsupported',raw:fields.D??'',reason:'有効期間B/Cを確定できません'};
  const body=bodySchedule(n);
  if(body)return body.diagnostic;
  return parse(n).diagnostic;
}
/** A fully understood D schedule can exclude a time even when E remains unresolved. */
function parsedWindowStatus(n:SchedulableNotice,parsed:ReturnType<typeof parse>,from:number,to:number):'active'|'inactive'|'unknown'{
  const start=Math.max(from,n.start!),end=Math.min(to,n.permanent?Infinity:n.end!);
  if(start>end||(n.end!==null&&!n.permanent&&start>=n.end))return 'inactive';
  if(parsed.diagnostic.status==='unsupported')return 'unknown';
  if (parsed.diagnostic.status === 'continuous') return 'active';
  if (parsed.periods?.some(p=>p.start<=end&&p.end>start))return 'active';
  if (end - start > 370 * DAY) return 'unknown';
  // Previous UTC day is necessary for overnight intervals.
  for (let day = Math.floor(start / DAY) * DAY - DAY; day <= end; day += DAY) {
    const date = new Date(day);
    for (const rule of parsed.rules) {
      if (rule.year !== undefined && date.getUTCFullYear() !== rule.year) continue;
      if (rule.month !== undefined && date.getUTCMonth() !== rule.month) continue;
      if (rule.days && !rule.days.includes(date.getUTCDate())) continue;
      if (rule.weekdays && !rule.weekdays.includes(date.getUTCDay())) continue;
      for (const [a, b] of rule.times) {
        const lo = Math.max(day + a * 60000, n.start!), hi = Math.min(day + b * 60000, n.permanent ? Infinity : n.end!);
        if (lo <= end && hi > start && hi > lo) return 'active';
      }
    }
  }
  return 'inactive';
}
/** Unknown is intentionally distinct from inactive. Use this status alongside boolean filters. */
export const notamWindowStatus: (n: SchedulableNotice,from:number,to:number)=>'active'|'validity'|'inactive'|'unknown' = memoizeNoticeQuery(function notamWindowStatusUncached(n: SchedulableNotice, from: number, to: number): 'active' | 'validity' | 'inactive' | 'unknown' {
  if (n.cancelled || noticeHeader(n.text).kind === 'C') return 'inactive';
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 'unknown';
  if (outsideKnownValidity(n,from,to)) return 'inactive';
  if (/\d{10}\s*EST\b/i.test(notamFields(n.text).C ?? '') && n.end !== null && to >= n.end) {
    if(from>=n.end)return 'unknown';
    const known=notamWindowStatus(n,from,n.end-1);
    return known==='active'||known==='validity'?known:'unknown';
  }
  if (scheduleDiagnostics(n).status === 'unsupported') {
    if(!hasKnownNotamValidity(n))return 'unknown';
    const d=parse(n);
    // Only a completely parsed D schedule may exclude a query. Unread solar or
    // other D syntax does not discard independently known B/C bounds.
    return d.diagnostic.status==='supported'&&parsedWindowStatus(n,d,from,to)==='inactive'?'inactive':'validity';
  }
  const start = Math.max(from, n.start!), end = Math.min(to, n.permanent ? Infinity : n.end!);
  if (start > end || (n.end !== null && !n.permanent && start >= n.end)) return 'inactive';
  const body=bodySchedule(n);if(body)return body.periods.some(p=>p.start<=end&&p.end>start)?'active':'inactive';
  return parsedWindowStatus(n,parse(n),from,to);
});
export const notamIsActive = (n: SchedulableNotice, now = Date.now()) => notamWindowStatus(n, now, now) === 'active';
export const notamOverlaps = (n: SchedulableNotice, start: number, end: number) => notamWindowStatus(n, start, end) === 'active';
/** Upcoming display period: next D interval, or B for a clearly labeled B/C fallback. */
export const notamStartsWithin = (n: SchedulableNotice, now: number, hours: number) => {
 if(!Number.isFinite(hours)||hours<=0||!Number.isFinite(now)||notamWindowStatus(n,now,now)!=='inactive')return false;
 const horizon=now+hours*3600000,end=/\d{10}\s*EST\b/i.test(notamFields(n.text).C??'')&&n.end!==null?Math.min(horizon,n.end-1):horizon;
 return end>=now&&['active','validity'].includes(notamWindowStatus(n,now,end));
};
/** Enumerate the validated D-field windows over a bounded published validity span. */
export function notamPeriods(n:SchedulableNotice):{start:number;end:number}[]{
 if(scheduleDiagnostics(n).status !== 'supported' || n.start===null || n.end===null || n.end-n.start>370*DAY)return [];
 const body=bodySchedule(n);if(body)return body.periods;
 const out=scheduleWindows(n,parse(n));
 return [...new Map(out.map(p=>[`${p.start}/${p.end}`,p])).values()].sort((a,b)=>a.start-b.start);
}

/** Explain the exact supported rule, not just its recognized time tokens. */
export function describeNotamSchedule(n: SchedulableNotice): {text: string; evidence: string; supported: boolean}[] {
  const diagnostic=scheduleDiagnostics(n);
  if(diagnostic.status==='unsupported') return [{text:`実施時間を確定できません。${diagnostic.reason || '原文の条件を確認してください。'}`,evidence:diagnostic.raw,supported:false}];
  if(diagnostic.status==='continuous') return [{text:'D欄による時間帯の限定はありません。B・C欄が示す有効期間内の通知です。施設の運用時間や個別の条件は本文の説明を確認してください。',evidence:'D欄の記載なし',supported:true}];
  const body=bodySchedule(n);if(body)return [{text:`E欄の実施時間とB/C/D欄が重なる${body.periods.length}区間に限定しています（UTC）。`,evidence:body.diagnostic.raw,supported:true}];
  const weekdays=['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
  const clockText=(minutes:number)=>`${Math.floor(minutes/60).toString().padStart(2,'0')}:${(minutes%60).toString().padStart(2,'0')}`;
  const parsed=parse(n);
  const continuous=(parsed.periods||[]).filter(p=>p.start<n.end!&&p.end>n.start!).map(period=>({text:`${new Date(Math.max(n.start!,period.start)).toISOString().slice(0,16).replace('T',' ')}から${new Date(Math.min(n.end!,period.end)).toISOString().slice(0,16).replace('T',' ')}まで連続（UTC）。`,evidence:diagnostic.raw,supported:true}));
  return [...continuous,...parsed.rules.map(rule=>{
    const selector=rule.weekdays?`${rule.month===undefined?'':`${rule.month+1}月の`}毎週${rule.weekdays.map(day=>weekdays[day]).join('・')}`:rule.days?`${rule.month===undefined?'':`${rule.month+1}月`}${rule.days.map(day=>`${day}日`).join('・')}`:'毎日';
    const windows=rule.times.map(([start,end])=>start===0&&end===1440?'終日':`${clockText(start)}から${end>=1440?'翌日':''}${clockText(end%1440)}まで`).join('、');
    return {text:`${selector}の${windows}（UTC）。B・C欄の有効期間内に限ります。`,evidence:diagnostic.raw,supported:true};
  })];
}

export function compileStaticSchedule(n:SchedulableNotice){
 const body=bodySchedule(n),parsed=parse(n),diagnostic=scheduleDiagnostics(n),cancelled=!!n.cancelled||noticeHeader(n.text).kind==="C";
 const periods=diagnostic.status!=='supported'?undefined:body?.diagnostic.status==='supported'?body.periods:parsed.periods?.length||parsed.rules.some(rule=>rule.year!==undefined)?scheduleWindows(n,parsed):undefined;
 const validitySchedule=diagnostic.status==='unsupported'&&parsed.diagnostic.status==='supported'?{source:'D' as const,timeZone:'UTC' as const,status:'supported' as const,rules:parsed.rules,periods:parsed.periods||[]}:undefined;
 return {...(validitySchedule?{validitySchedule}:{}),validityKnown:hasKnownNotamValidity(n),timeBasis:diagnostic.status==='unsupported'?(hasKnownNotamValidity(n)&&!cancelled?'validity-fallback':'unknown'):'activity',...(periods?{periods}:{}),diagnostic,rules:parsed.rules,cancelled,estimatedEnd:/\d{10}\s*EST\b/i.test(notamFields(n.text).C??"")};
}
