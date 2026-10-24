import type { Notice } from "./notam";
export type NavPeriod = { start: number; end: number; text: string; precision?: "date"|"mixed"; startPrecision?: "date"|"time"; endPrecision?: "date"|"time"; scopeLabel?: string };
const DAY = 86400000;
function normalize(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, "")
    .replace(/[-—–－~～]/g, "至").replace(/到/g, "至").replace(/每天/g, "每日")
    .replace(/(?<!\d)(\d{1,2}):(\d{2})(?:时)?(?!\d)/g, (_, h, m) => `${h.padStart(2, "0")}${m}时`)
    .replace(/(?<!\d)(\d{1,2})至(\d{1,2})时(?!\d)/g, (_, a, b) => `${a.padStart(2, "0")}00时至${b.padStart(2, "0")}00时`)
    .replace(/(\d{1,2})时(\d{1,2})分/g, (_, h, m) => `${h.padStart(2, "0")}${m.padStart(2, "0")}时`)
    .replace(/(?<!\d)(\d{1,2})时/g, (_, h) => `${h.padStart(2, "0")}00时`)
    .replace(/(\d{1,2}月\d{1,2})(?=至(?:(?:20\d{2})年)?(?:\d{1,2}月)?\d{1,2}日)/g, "$1日")
    .replace(/(?<=\d)-(?=\d{1,2}(?:月|日)|\d{3,4}时)/g, "至");
}
function stamp(year: number, month: number, day: number, digits = "0000") {
  const hour = Math.floor(+digits / 100), minute = +digits % 100;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return date.getTime() + (hour - 8) * 3600000 + minute * 60000;
}
function yearFor(month: number, issued: number | null) {
  if (issued === null || !Number.isFinite(issued)) return Number.NaN;
  const base = new Date(issued + 8 * 3600000), y = base.getUTCFullYear(), m = base.getUTCMonth() + 1;
  return y + (m === 12 && month === 1 ? 1 : m === 1 && month === 12 ? -1 : 0);
}
function endDate(year: number, month: number, day: number, endYear?: string, endMonth?: string, endDay?: string) {
  let y = endYear ? +endYear : year, m = endMonth ? +endMonth : month, d = endDay ? +endDay : day;
  if (!endYear && endMonth && m < month) y++;
  if (!endMonth && d < day) { m++; if (m > 12) { m = 1; y++; } }
  return { y, m, d };
}
function valid(start: number | null, end: number | null, text: string): NavPeriod[] {
  return start !== null && end !== null && end > start ? [{ start, end, text }] : [];
}
function calendarConditions(text: string) {
  // Access exceptions for named vessel classes are not date exceptions. Keep
  // anything involving dates, days or times conservative.
  return text.replace(/除[^。；;]*?外/g, exception =>
    /船舶|船艇/.test(exception) && !/\d|日|时|天|周|星期|节假|工作/.test(exception) ? "" : exception);
}
function parseDateClause(text: string, issued: number | null): NavPeriod[] {
  // Unsupported exception calendars must not become continuous periods.
  if (/工作日|节假日|除[^。；;]*外/.test(calendarConditions(text))) return [];
  const date = text.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/);
  if (!date) return [];
  const y = date[1] ? +date[1] : yearFor(+date[2], issued), m = +date[2], d = +date[3];
  const tail = text.slice(date.index! + date[0].length);
  // Date-to-date span, with an explicit start time or optional end year/month.
  const span = tail.match(/^(?:(\d{3,4})时?(?!\d))?至(?:(20\d{2})年)?(?:(\d{1,2})月)?(\d{1,2})日(?:(\d{3,4})时?(?!\d))?/);
  if (span) {
    const e = endDate(y, m, d, span[2], span[3], span[4]);
    const rest = tail.slice(span[0].length);
    const daily = /每日/.test(rest);
    const weekly = weeklySchedule(rest);
    const windows = [...rest.matchAll(/(?<!\d)(\d{3,4})时?(?!\d)至(次日)?(\d{3,4})时?(?!\d)/g)];
    if (/每周|每星期/.test(rest) && !weekly) return [];
    if (daily || weekly) {
      if (!windows.length) return [];
      const first = stamp(y, m, d), last = stamp(e.y, e.m, e.d);
      if (first === null || last === null || last < first || last - first > 366 * DAY) return [];
      const startLimit = span[1] ? stamp(y, m, d, span[1]) : first;
      const endLimit = span[5] ? stamp(e.y, e.m, e.d, span[5]) : Number.POSITIVE_INFINITY;
      if (startLimit === null || endLimit === null || endLimit < startLimit) return [];
      const periods: NavPeriod[] = [];
      for (let day = first; day <= last; day += DAY) {
        const local = new Date(day + 8 * 3600000);
        if (weekly && !weekly.has(local.getUTCDay())) continue;
        for (const window of windows) {
          const start = stamp(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), window[1]);
          let end = stamp(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), window[3]);
          if (start !== null && end !== null && (window[2] || +window[3] < +window[1])) end += DAY;
          if (start !== null && end !== null && Math.min(end, endLimit) > Math.max(start, startLimit)) periods.push(...valid(Math.max(start, startLimit), Math.min(end, endLimit), text));
        }
      }
      return periods;
    }
    // A time range after a date span without 每日 is ambiguous, not an all-day range.
    if (windows.length || /白天|白昼|白晝|夜间|夜間|早晨|早上|上午|中午|下午|晚上|晚间|晚間|凌晨|傍晚|日出|日没|日沒|日落|黎明|黄昏|黃昏|\d{3,4}时|每天|每日/.test(rest.split(/在以下|以下|位于|位於|进行|進行/)[0])) return [];
    const bounded=valid(stamp(y, m, d, span[1] || "0000"), stamp(e.y, e.m, e.d, span[5] || "2400"), text);
    return bounded.map(p=>({...p,...(!span[1]||!span[5]?{precision:!span[1]&&!span[5]?"date" as const:"mixed" as const,startPrecision:span[1]?"time" as const:"date" as const,endPrecision:span[5]?"time" as const:"date" as const}:{})}));
  }
  // Explicit listed dates share their following time windows; no dates between them.
  const list = tail.match(/^((?:[、,，和及](?:(?:20\d{2})年)?(?:\d{1,2}月)?\d{1,2}日)+)/);
  if (list) {
    const rest = tail.slice(list[0].length);
    const windows = [...rest.matchAll(/(?<!\d)(\d{3,4})时?(?!\d)至(次日)?(\d{3,4})时?(?!\d)/g)];
    if (!windows.length) return [];
    const days = [{ y, m, d }];
    for (const entry of list[0].matchAll(/(?:(20\d{2})年)?(?:(\d{1,2})月)?(\d{1,2})日/g)) days.push(endDate(y, m, d, entry[1], entry[2], entry[3]));
    return days.flatMap(day => windows.flatMap(window => {
      const start = stamp(day.y, day.m, day.d, window[1]); let end = stamp(day.y, day.m, day.d, window[3]);
      if (start !== null && end !== null && (window[2] || +window[3] < +window[1])) end += DAY;
      return valid(start, end, text);
    }));
  }
  // Only immediately associated time windows; stop before a new date or prose.
  const run = tail.match(/^[,，:：]?(?:每日)?((?:\d{3,4}时?(?!\d)至(?:次日)?\d{3,4}时?(?!\d)(?:[、,，和及]|$)?)+)/)?.[1];
  if (!run) return [];
  return [...run.matchAll(/(?<!\d)(\d{3,4})时?(?!\d)至(次日)?(\d{3,4})时?(?!\d)/g)].flatMap(window => {
    const start = stamp(y, m, d, window[1]); let end = stamp(y, m, d, window[3]);
    if (start !== null && end !== null && (window[2] || +window[3] < +window[1])) end += DAY;
    return valid(start, end, text);
  });
}
// Only literal weekday calendars are supported. Workdays, holidays and exceptions
// remain uncertain; they require external calendars rather than date arithmetic.
function weeklySchedule(text: string): Set<number> | null {
  const match = text.match(/^[,，:：]*(?:每周|每星期)([一二三四五六日天](?:(?:[、,，和及]|至)(?:(?:周|星期))?[一二三四五六日天])*)[,，:：]*(?=\d{3,4}时?至)/);
  if (!match) return null;
  const map: Record<string, number> = { "日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6 };
  const days = new Set<number>();
  for (const part of match[1].replace(/周|星期/g, "").split(/[、,，和及]/)) {
    const [first, last] = part.split("至");
    if (last) {
      for (let day = map[first]; ; day = (day + 1) % 7) {
        days.add(day);
        if (day === map[last]) break;
      }
    } else days.add(map[first]);
  }
  // A second calendar expression with another window needs a separate parser.
  if (/每周|每星期|周[一二三四五六日天]|星期[一二三四五六日天]/.test(text.slice(match[0].length))) return null;
  return days;
}
function hasParsedWeeklyCalendar(period: NavPeriod) {
  const span = period.text.match(/^(?:(?:20\d{2})年)?\d{1,2}月\d{1,2}日(?:\d{3,4}时?)?至(?:(?:20\d{2})年)?(?:\d{1,2}月)?\d{1,2}日(?:\d{3,4}时?)?(.*)$/);
  return !!span && !!weeklySchedule(span[1]);
}

function parseClause(text: string, issued: number | null): NavPeriod[] {
  // Publication/broadcast schedules are metadata, never operating activity.
  const activity = text.split(/播发时间|播發時間/)[0];
  const periods: NavPeriod[] = [];
  const dates = [...activity.matchAll(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/g)];
  // Never lose a calendar restriction occurring before the first candidate.
  if (/工作日|节假日|除[^。；;]*外/.test(calendarConditions(activity))) return [];
  if (dates.length && /每周|每星期/.test(activity.slice(0, dates[0].index))) return [];
  for (const date of dates) {
    const index = date.index!;
    // Do not interpret a span's end date as a separate daily schedule.
    if (activity[index - 1] === "至") continue;
    const prefix=activity.slice(0,index);
    const scopeLabel=/禁航时间[:：]?$/.test(prefix)?"通航禁止":/管制时间[:：]?$/.test(prefix)?"航行規制":/(?:作业|施工)时间[:：]?$/.test(prefix)?"作業":/活动时间[:：]?$/.test(prefix)?"活動":undefined;
    periods.push(...parseDateClause(activity.slice(index), issued).map(p=>({...p,...(scopeLabel?{scopeLabel}:{})})));
  }
  // An explicitly temporary installation followed by its removal defines a
  // genuine bounded activity period. An ordinary departure/arrival does not.
  const temporary = activity.match(/((?:(?:20\d{2})年)?\d{1,2}月\d{1,2}日\d{3,4}时)(?!\d)([^。；;]{0,250}?临时设置[^。；;]{0,250}?)((?:(?:20\d{2})年)?\d{1,2}月\d{1,2}日\d{3,4}时)(?!\d)撤除/);
  if (temporary) periods.push(...parseDateClause(`${temporary[1]}至${temporary[3]}`, issued));
  return periods;
}

export function navPeriodAnalysis(text: string, issued: number | null): { periods: NavPeriod[]; unparsedClauses: string[] } {
  const normalized = normalize(text).split(/发布方式|發布方式|播发时间|播發時間/)[0];
  if (/(?:(?:星期|周)[一二三四五六日天](?:不作业|不作業|停止|暂停|暫停|休息)|取消(?:20\d{2}年)?(?:\d{1,2}月)?\d{1,2}日(?:的)?(?:作业|作業|活动|活動))/.test(normalized)) return {periods:[],unparsedClauses:[normalized]};
  const periods: NavPeriod[] = [], unparsedClauses: string[] = [];
  let lastMonth = "", lastYear = "", lastDay = 0;
  const clauses = normalized.split(/[。；;]/).flatMap(sentence => {
    // Do not detach a preceding date exception from the span it restricts.
    const firstDate = sentence.search(/(?:(?:20\d{2})年)?\d{1,2}月\d{1,2}日/);
    const prefix = firstDate < 0 ? sentence : sentence.slice(0, firstDate);
    if (/工作日|节假日|除[^。；;]*外/.test(calendarConditions(sentence)) || /每周|每星期/.test(prefix)) return [sentence];
    return sentence.split(/(?:[，,、和]|以及|及)(?=(?:20\d{2}年)?(?:\d{1,2}月)?\d{1,2}日(?:\d{3,4}时?)?至)/);
  });
  for (let clause of clauses) {
    const firstDate = clause.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/);
    if (firstDate) { lastMonth = firstDate[2]; lastYear = firstDate[1] || ""; lastDay = +firstDate[3]; }
    else if (lastMonth && /^\d{1,2}日(?:\d{3,4}|至)/.test(clause)) {
      const day = +clause.match(/^(\d{1,2})日/)![1];
      const date = endDate(lastYear ? +lastYear : yearFor(+lastMonth, issued), +lastMonth, lastDay, undefined, undefined, String(day));
      clause = `${date.y}年${date.m}月${clause}`;
      lastYear = String(date.y); lastMonth = String(date.m); lastDay = day;
    }
    // Expand immediate effectiveness through the same calendar parser. Never
    // discard daily/weekly restrictions by reading only the end-date prefix.
    const immediate = /即日起至/.test(clause);
    let parseText = clause;
    if (immediate && issued !== null && Number.isFinite(issued)) {
      const local = new Date(issued + 8 * 3600000);
      parseText = clause.replace(/即日起至(?:(20\d{2})年)?(\d{1,2})月/, (_, year, month) => `${local.getUTCFullYear()}年${local.getUTCMonth() + 1}月${local.getUTCDate()}日至${year || yearFor(+month, issued)}年${month}月`);
    }
    const parsed = immediate
      ? issued !== null && Number.isFinite(issued)
        ? parseClause(parseText, issued).filter(p => p.end > issued).map(p => ({...p, start: Math.max(p.start, issued), text: clause}))
        : []
      : parseClause(clause, issued);
    periods.push(...parsed);
    // A malformed extra clock must not disappear behind a successfully parsed window.
    const invalidClock=[...clause.matchAll(/(?<!\d)(\d{3,})时/g)].some(m=>m[1].length>4||+m[1]>2400||+m[1]%100>59||Math.floor(+m[1]/100)===24&&+m[1]%100!==0);
    if(invalidClock) unparsedClauses.push(clause);
    let residual=calendarConditions(clause.split(/在以下|以下|位于|位於|进行|進行/)[0]).replace(/(?<!\d)\d{3,4}时?(?!\d)至(?:次日)?\d{3,4}时?(?!\d)/g,"").replace(/\d{1,2}日\d{3,4}时?/g,"");
    // Remove the weekly marker only after that exact bounded calendar parsed.
    // Multiple or unsupported weekly expressions continue to warn.
    if ([...clause.matchAll(/每周|每星期/g)].length === 1 && parsed.some(hasParsedWeeklyCalendar)) residual = residual.replace(/每周|每星期/, "");
    if(parsed.length && /白天|白昼|白晝|夜间|夜間|早晨|早上|上午|中午|下午|晚上|晚间|晚間|凌晨|傍晚|日出|日没|日沒|日落|黎明|黄昏|黃昏|每周|每星期|工作日|节假日|除[^。；;]*外|\d{3,4}时/.test(residual)) unparsedClauses.push(clause);
    if (!parsed.length && (immediate || /(?:\d{1,2}月)?\d{1,2}日(?:\d{3,4}时?|至|[、,，和及]\d{1,2}日|[，,]?(?:每日|每周|每星期))/.test(clause))) unparsedClauses.push(clause);
  
  }
  const unique = new Map(periods.map(period => [`${period.start}/${period.end}`, period]));
  return { periods: [...unique.values()].sort((a, b) => a.start - b.start || a.end - b.end), unparsedClauses:[...new Set(unparsedClauses)] };
}
export function navPeriods(text: string, issued: number | null): NavPeriod[] {
  return navPeriodAnalysis(text, issued).periods;
}
export const partialPeriodWarning = "本文に自動判定できない日時条件があります。表示は読み取れた時間帯のみです。原文を確認してください。";
export function navPeriodWarnings(text: string, issued: number | null): string[] {
  const { periods, unparsedClauses } = navPeriodAnalysis(text, issued);
  return periods.length && unparsedClauses.length ? [partialPeriodWarning] : [];
}
export function navDates(text: string, issued: number | null) {
  const periods = navPeriods(text, issued);
  return periods.length ? { start: Math.min(...periods.map(p => p.start)), end: Math.max(...periods.map(p => p.end)) } : { start: null, end: null };
}
export function noticeNavPeriods(item:Notice) { return item.validityPeriods !== undefined ? item.validityPeriods : navPeriods(item.text,item.issued); }
export function navOverlaps(item: Notice, start: number, end: number) {
  return !item.cancelled && Number.isFinite(start) && Number.isFinite(end) && start <= end && noticeNavPeriods(item).some(p => p.start <= end && p.end > start);
}
export function navIsActive(item: Notice, now: number) {
  return !item.cancelled && !(item.sourceCountry==='TW'&&(item.timeUncertain||item.lifecycleUncertain)) && Number.isFinite(now) && noticeNavPeriods(item).some(p => p.start <= now && p.end > now);
}
export function navStartsWithin(item: Notice, now: number, hours: number) {
  return !item.cancelled && !(item.sourceCountry==='TW'&&(item.timeUncertain||item.lifecycleUncertain)) && Number.isFinite(now) && Number.isFinite(hours) && hours > 0 && !navIsActive(item, now) && noticeNavPeriods(item).some(p => p.start > now && p.start <= now + hours * 3600000);
}
