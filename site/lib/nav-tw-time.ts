/**
 * Conservative parser for an extracted Taiwan notice SCHEDULE field, not a whole
 * notice or publication date. All timestamps are UTC milliseconds; end is exclusive.
 * No system clock, publication timestamp, locale, or machine timezone is consulted.
 *
 * Source conventions must be established by the caller and supplied with their
 * provenance. A Taiwan publisher alone establishes neither its calendar nor its
 * timezone. Unknown or partly understood schedules return no operational periods.
 */
export type TwTimePrecision = 'day' | 'minute';
export type TwTimePeriod = { start: number; end: number; text: string; precision: TwTimePrecision };
export type TwTimeEvidence = { kind: 'schedule' | 'timezone' | 'calendar' | 'interpretation'; text: string; source?: string };
export type TwTimeOptions = {
  defaultTimezone?: { timezone: 'Asia/Taipei' | 'UTC+8' | 'UTC+08:00'; source: string; evidence: string };
  defaultCalendar?: { calendar: 'ROC'; source: string; evidence: string };
};
export type TwTimeAnalysis = {
  periods: TwTimePeriod[];
  timezone?: { name: string; offsetMinutes: number; evidence: string; source?: string };
  precision?: TwTimePrecision | 'mixed';
  confidence: 'explicit' | 'source-convention' | 'unknown';
  reasons: string[];
  evidence: TwTimeEvidence[];
  /** Detected wording, not a resolved lifecycle state. Never activate it directly. */
  flags: { cancellation: boolean; amendment: boolean };
};
type DateParts = { year: number; month: number; day: number };
type DateToken = { kind: 'date'; text: string; year?: number; month?: number; day: number };
type ClockToken = { kind: 'clock'; text: string; minutes: number };
type Token = DateToken | ClockToken | { kind: 'range' | 'comma' | 'break' | 'daily' | 'next' | 'overnight' | 'allDay'; text: string };
const DAY = 86400000;
const MINUTE = 60000;
class Unsupported extends Error {}
function fail(reason: string): never { throw new Unsupported(reason); }
function provenance(value: { source: string; evidence: string } | undefined): boolean {
  return !!value && typeof value.source === 'string' && !!value.source.trim() && typeof value.evidence === 'string' && !!value.evidence.trim();
}
function validDate(d: DateParts): number {
  if (d.year < 1900 || d.year > 2199 || d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31) fail('Date is outside the supported calendar range (1900–2199).');
  const n = Date.UTC(d.year, d.month - 1, d.day), actual = new Date(n);
  if (actual.getUTCFullYear() !== d.year || actual.getUTCMonth() + 1 !== d.month || actual.getUTCDate() !== d.day) fail('Invalid calendar date; date rollover is not permitted.');
  return n;
}
function zoneName(offset: number): string {
  if (offset === 0) return 'UTC';
  const n = Math.abs(offset);
  return `UTC${offset < 0 ? '-' : '+'}${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
function extractTimezone(text: string, options: TwTimeOptions, result: TwTimeAnalysis): string {
  const zones: Array<{ offset: number; text: string }> = [];
  text = text.replace(/\b(?:UTC|GMT)\s*(?:([+-])\s*(\d{1,4})(?::(\d{1,2}))?)?/gi, (whole, sign: string | undefined, digits: string | undefined, minute: string | undefined) => {
    let offset = 0;
    if (sign && digits) {
      const hour = digits.length > 2 ? +(digits.slice(0, -2)) : +digits;
      const mins = digits.length > 2 ? +(digits.slice(-2)) : +(minute || '0');
      if (digits.length === 3 || digits.length > 2 && minute !== undefined || hour > 14 || mins > 59 || hour === 14 && mins !== 0) fail('Invalid explicit UTC/GMT offset.');
      offset = (hour * 60 + mins) * (sign === '-' ? -1 : 1);
    }
    zones.push({ offset, text: whole.trim() });
    return ' ';
  });
  text = text.replace(/(?:臺灣|台灣|臺北|台北)(?:當地|当地|本地|標準|标准)?時間|(?:臺灣|台灣|臺北|台北)(?:當地|当地|本地|標準|标准)?时间|中原標準時間|中原标准时间|\b(?:Taiwan|Taipei)\s+(?:local\s+|standard\s+)?time\b|\blocal\s+(?:Taiwan|Taipei)\s+time\b|\bAsia\/Taipei\b/gi, whole => {
    zones.push({ offset: 480, text: whole });
    return ' ';
  });
  if (/\b(?:CST|TST|EST|PST|local\s+time)\b|(?:當地|当地|本地)時間|(?:當地|当地|本地)时间/i.test(text)) fail('Timezone abbreviation or local time has no unambiguous Taiwan timezone evidence.');
  if (new Set(zones.map(z => z.offset)).size > 1) fail('Conflicting explicit timezone evidence; no timezone was selected.');
  if (zones.length) {
    const evidence = [...new Set(zones.map(z => z.text))].join('; ');
    result.timezone = { name: zoneName(zones[0].offset), offsetMinutes: zones[0].offset, evidence };
    result.evidence.push({ kind: 'timezone', text: evidence });
  } else if (options.defaultTimezone !== undefined) {
    const convention = options.defaultTimezone;
    if (!provenance(convention) || !['Asia/Taipei', 'UTC+8', 'UTC+08:00'].includes(convention.timezone)) fail('The default Taiwan timezone requires a supported timezone and source/evidence provenance.');
    result.timezone = { name: 'UTC+08:00', offsetMinutes: 480, evidence: convention.evidence, source: convention.source };
    result.evidence.push({ kind: 'timezone', text: convention.evidence, source: convention.source });
    result.reasons.push('UTC+08:00 comes from the caller-supplied, sourced Taiwan-local convention.');
  } else {
    result.reasons.push('Timezone is unknown: no explicit timezone or sourced Taiwan-local convention was supplied.');
  }
  // Only remove recognized timezone captions and now-empty punctuation. This does
  // not remove arbitrary parentheticals, which may contain important restrictions.
  return text.replace(/(?:所有|全部|以上|以下)?(?:時間|时间)(?:均為|均为|皆為|皆为|為|为)\s*(?=[,，;；。()\s]|$)/g, ' ')
    .replace(/\ball\s+times?\s+(?:are\s+)?(?:in\s+)?(?=[,;().\s]|$)/gi, ' ')
    .replace(/\(\s*\)/g, ' ');
}
function calendarYear(label: string | undefined, digits: string, options: TwTimeOptions, result: TwTimeAnalysis): number {
  const roc = !!label && /民國|民国|ROC|R\.O\.C\./i.test(label);
  if (roc) {
    if (+digits < 1 || +digits > 288) fail('Invalid ROC calendar year.');
    result.evidence.push({ kind: 'calendar', text: `${label} ${digits} is explicitly ROC; Gregorian year ${+digits + 1911}.` });
    return +digits + 1911;
  }
  if (digits.length === 4) return +digits;
  if (label) fail('A Gregorian calendar label requires a four-digit Gregorian year.');
  const convention = options.defaultCalendar;
  if (!convention || convention.calendar !== 'ROC' || !provenance(convention)) fail('An unlabelled short year requires a sourced ROC calendar convention; it is not inferred from publication.');
  if (+digits < 1 || +digits > 288) fail('Invalid ROC calendar year.');
  result.evidence.push({ kind: 'calendar', text: convention.evidence, source: convention.source });
  result.reasons.push(`Unlabelled year ${digits} is interpreted as ROC ${digits} (${+digits + 1911}) under the sourced calendar convention.`);
  return +digits + 1911;
}
function clockValue(hour: number, minute: number, phase = ''): number {
  if (minute > 59 || minute < 0) fail('Invalid clock minutes.');
  if (/^(?:中午|正午|noon)$/i.test(phase)) {
    if (hour !== 12 || minute !== 0) fail('Noon must denote exactly 12:00.');
    return 720;
  }
  if (/^(?:午夜|子夜|midnight)$/i.test(phase)) {
    if (![0, 12].includes(hour) || minute !== 0) fail('Midnight must denote exactly 00:00.');
    return 0;
  }
  if (/^(?:am|a\.m\.|上午)$/i.test(phase)) {
    if (hour < 1 || hour > 12) fail('Invalid twelve-hour morning clock.');
    hour %= 12;
  } else if (/^(?:pm|p\.m\.|下午|晚上|晚間|晚间)$/i.test(phase)) {
    if (hour < 1 || hour > 12) fail('Invalid twelve-hour afternoon/evening clock.');
    hour = hour % 12 + 12;
  } else if (phase === '凌晨') {
    if (hour > 11) fail('An early-morning clock must be before noon.');
  }
  if (hour > 24 || hour < 0 || hour === 24 && minute !== 0) fail('Invalid clock hour; only endpoint 24:00 is supported.');
  return hour * 60 + minute;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function tokenize(text: string, options: TwTimeOptions, result: TwTimeAnalysis): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const add = (token: Token) => { tokens.push(token); at += token.text.length; };
  while (at < text.length) {
    const s = text.slice(at);
    const whitespace = s.match(/^[ \t\r]+/); if (whitespace) { at += whitespace[0].length; continue; }
    const header = s.match(/^(?:(?:活動|活动|射擊|射击|作業|作业|演習|演习|訓練|训练|管制|施放|有效|預定|预定|實施|实施|預計|预计)?(?:日期及時間|日期及时间|日期與時間|日期与时间|日期|時間|时间|期間|期间)|scheduled\s+times?|operating\s+(?:dates?|times?)|effective\s+(?:dates?|times?|period)|schedule)\s*[:：]?\s*/i);
    if (header) { at += header[0].length; continue; }
    const filler = s.match(/^(?:自|從|从|於|于|起(?=至|到|迄)|起|止|\bfrom\b|\bon\b|\bat\b|\binclusive\b|\(含\))\s*/i);
    if (filler) { at += filler[0].length; continue; }
    const separator = s.match(/^(?:\n|[;；。.])+/); if (separator) { add({ kind: 'break', text: separator[0] }); continue; }
    const range = s.match(/^(?:至|到|迄|[~～—–-]|\b(?:to|through|until)\b)/i); if (range) { add({ kind: 'range', text: range[0] }); continue; }
    const comma = s.match(/^(?:[,，、]|以及|及|與|与|和|\band\b)/i); if (comma) { add({ kind: 'comma', text: comma[0] }); continue; }
    const daily = s.match(/^(?:每日|每天|\bdaily\b|\beach\s+day\b)/i); if (daily) { add({ kind: 'daily', text: daily[0] }); continue; }
    const next = s.match(/^(?:次日|翌日|隔日|\b(?:the\s+)?(?:next|following)\s+day\b)/i); if (next) { add({ kind: 'next', text: next[0] }); continue; }
    const overnight = s.match(/^(?:\(\s*(?:跨日|跨夜|overnight)\s*\)|跨日|跨夜|\bovernight\b)/i); if (overnight) { add({ kind: 'overnight', text: overnight[0] }); continue; }
    const allDay = s.match(/^(?:全天|全日|\ball\s+day\b)/i); if (allDay) { add({ kind: 'allDay', text: allDay[0] }); continue; }
    // Calendar labels belong to a date token and cannot supply an event year elsewhere.
    const chinese = s.match(/^(?:(中華民國|中华民国|民國|民国|西元|公元|ROC\.?|R\.O\.C\.)\s*)?(\d{1,4})年\s*(\d{1,2})月\s*(\d{1,2})日/i);
    if (chinese) { add({ kind: 'date', text: chinese[0], year: calendarYear(chinese[1], chinese[2], options, result), month: +chinese[3], day: +chinese[4] }); continue; }
    const numeric = s.match(/^(?:(民國|民国|ROC\.?|R\.O\.C\.)\s*)?(\d{3,4})([-/.])(\d{1,2})\3(\d{1,2})(?!\d)/i);
    if (numeric) { add({ kind: 'date', text: numeric[0], year: calendarYear(numeric[1], numeric[2], options, result), month: +numeric[4], day: +numeric[5] }); continue; }
    const english = s.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,)?\s+(\d{4})\b/i);
    if (english) { add({ kind: 'date', text: english[0], year: +english[3], month: MONTHS.indexOf(english[1].slice(0, 3).toLowerCase()) + 1, day: +english[2] }); continue; }
    const partial = s.match(/^(?:(\d{1,2})月\s*)?(\d{1,2})日/);
    if (partial) { add({ kind: 'date', text: partial[0], month: partial[1] ? +partial[1] : undefined, day: +partial[2] }); continue; }
    // Symbolic noon/midnight retain an exact meaning. Midnight is 00:00 at the
    // beginning of its named day; next-day wording is required where ambiguous.
    const symbolic = s.match(/^(中午|正午|午夜|子夜)(?:\s*(\d{1,2})(?:[:：](\d{2})|(?:時|时|點|点)(?:(\d{1,2})分)?)?)?/);
    if (symbolic) {
      if (/午夜|子夜/.test(symbolic[1])) result.evidence.push({ kind: 'interpretation', text: 'Midnight denotes 00:00 at the beginning of its stated day; it is not silently moved to the next day.' });
      const h = symbolic[2] ? +symbolic[2] : /中午|正午/.test(symbolic[1]) ? 12 : 0;
      add({ kind: 'clock', text: symbolic[0], minutes: clockValue(h, +(symbolic[3] || symbolic[4] || 0), symbolic[1]) }); continue;
    }
    const enSymbolic = s.match(/^(?:(12)(?::(00))?\s+)?(noon|midnight)\b/i);
    if (enSymbolic) { if (/midnight/i.test(enSymbolic[3])) result.evidence.push({ kind: 'interpretation', text: 'Midnight denotes 00:00 at the beginning of its stated day; it is not silently moved to the next day.' }); add({ kind: 'clock', text: enSymbolic[0], minutes: /noon/i.test(enSymbolic[3]) ? 720 : 0 }); continue; }
    const clock = s.match(/^(?:(上午|下午|晚上|晚間|晚间|凌晨)\s*)?(?:(\d{1,2}):(\d{2})(?![:\d])|(\d{1,2})(?:時|时|點|点)(?:(\d{1,2})分)?|(\d{4})(?!\d)(?:\s*(?:時|时|hrs?\.?|hours?))?)(?:\s*(am|pm|a\.m\.|p\.m\.))?(?![A-Za-z])/i);
    if (clock) {
      const digits = clock[6];
      const hour = digits ? +digits.slice(0, 2) : +(clock[2] || clock[4]);
      const minute = digits ? +digits.slice(2) : +(clock[3] || clock[5] || 0);
      if (clock[1] && clock[7]) fail('A clock has two day-period qualifiers.');
      add({ kind: 'clock', text: clock[0], minutes: clockValue(hour, minute, clock[1] || clock[7]) }); continue;
    }
    // Bare 8am/8pm is explicit; a bare 8 is not a clock.
    const twelve = s.match(/^(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![A-Za-z])/i);
    if (twelve) { add({ kind: 'clock', text: twelve[0], minutes: clockValue(+twelve[1], 0, twelve[2]) }); continue; }
    fail(`Unsupported or ambiguous schedule text near “${s.slice(0, 52)}”.`);
  }
  return tokens;
}
function parseTokens(tokens: Token[], result: TwTimeAnalysis): Array<{ start: number; end: number; precision: TwTimePrecision }> {
  let at = 0, previous: DateParts | undefined;
  const localPeriods: Array<{ start: number; end: number; precision: TwTimePrecision }> = [];
  const peek = (kind: Token['kind'], delta = 0) => tokens[at + delta]?.kind === kind;
  const take = (kind: Token['kind']): Token => { if (!peek(kind)) fail(`Expected ${kind}; the schedule is incomplete or ambiguous.`); return tokens[at++]; };
  const resolve = (token: DateToken, base = previous): DateParts => {
    if ((token.year === undefined || token.month === undefined) && !base) fail('An operational date needs an explicit year and month; publication dates are never used.');
    const d = { year: token.year ?? base!.year, month: token.month ?? base!.month, day: token.day };
    validDate(d);
    if (token.year === undefined || token.month === undefined) {
      result.evidence.push({ kind: 'interpretation', text: `“${token.text}” inherits only the omitted year/month from the preceding explicit schedule date (${base!.year}-${base!.month}-${base!.day}); no month/year rollover is inferred.` });
    }
    previous = d;
    return d;
  };
  const push = (start: number, end: number, precision: TwTimePrecision) => {
    if (!(end > start)) fail('Period end must be later than its start; no unmarked overnight or calendar rollover is inferred.');
    if (localPeriods.length >= 2048) fail('Schedule expands beyond the supported 2048 periods.');
    localPeriods.push({ start, end, precision });
  };
  while (at < tokens.length) {
    while (peek('break') || peek('comma')) at++;
    if (at === tokens.length) break;
    const startDate = resolve(take('date') as DateToken);
    const dates = [startDate];
    let dateRange = false;
    if (peek('range') && peek('date', 1)) {
      at++;
      dates.push(resolve(take('date') as DateToken, startDate));
      dateRange = true;
      if (validDate(dates[1]) < validDate(startDate)) fail('Date range is reversed; omitted months or years never imply rollover.');
    } else {
      // Shared date lists are supported only when followed by a common window.
      while (peek('comma') && peek('date', 1)) {
        at++;
        dates.push(resolve(take('date') as DateToken));
      }
    }
    // A single comma between a date and its clock/daily marker is present in
    // government schedules. A comma before another date remains a clause boundary.
    if (peek('comma') && ['clock', 'daily', 'overnight', 'allDay'].includes(tokens[at + 1]?.kind)) at++;
    const daily = peek('daily'); if (daily) at++;
    const clauseOvernight = peek('overnight'); if (clauseOvernight) at++;
    const allDay = peek('allDay');
    if (allDay) {
      at++;
      if (daily) result.reasons.push('Daily all-day wording is represented using inclusive calendar dates.');
    }
    if (allDay && peek('clock')) fail('All-day wording conflicts with separate intraday clock endpoints.');
    if (!peek('clock')) {
      if (clauseOvernight) fail('Overnight wording requires explicit clock endpoints.');
      if (daily && tokens[at - 1]?.kind !== 'allDay') fail('Daily wording has no explicit time window.');
      if (at < tokens.length && !peek('comma') && !peek('break')) fail('Date-only schedule has an unsupported condition.');
      if (dateRange) push(validDate(dates[0]), validDate(dates[1]) + DAY, 'day');
      else for (const d of dates) push(validDate(d), validDate(d) + DAY, 'day');
      result.reasons.push('Date-only precision: named calendar dates are inclusive; the exclusive end is 00:00 on the following day. Intraday timing is unspecified.');
      continue;
    }
    if (dateRange && !daily) fail('A date range followed by clock windows requires explicit daily wording; it is not made continuous.');
    const baseDays: number[] = [];
    if (dateRange) {
      const first = validDate(dates[0]), last = validDate(dates[1]);
      if (last - first > 365 * DAY) fail('Daily expansion exceeds 366 named start dates.');
      for (let day = first; day <= last; day += DAY) baseDays.push(day);
    } else baseDays.push(...dates.map(validDate));
    do {
      const start = take('clock') as ClockToken;
      if (start.minutes === 1440) fail('24:00 is supported only as an endpoint, not a start time.');
      take('range');
      let endDay: number | undefined;
      const explicitNext = peek('next');
      if (explicitNext) at++;
      if (peek('date')) {
        if (daily || dateRange || dates.length !== 1 || explicitNext) fail('Explicit endpoint dates cannot be combined with daily/list/next-day semantics.');
        const endpoint = take('date') as DateToken;
        // A partial end date is anchored only to this schedule's explicit start.
        endDay = validDate(resolve(endpoint, startDate));
      }
      const end = take('clock') as ClockToken;
      const markedOvernight = clauseOvernight || peek('overnight');
      if (peek('overnight')) at++;
      if (markedOvernight && (endDay !== undefined || end.minutes >= start.minutes)) fail('Overnight wording requires an earlier end clock and no competing endpoint date.');
      let rollover = explicitNext ? DAY : 0;
      if (endDay === undefined && !explicitNext && end.minutes < start.minutes) {
        if (!daily && !markedOvernight) fail('End-before-start is ambiguous without explicit next-day wording or daily overnight semantics.');
        rollover = DAY;
        if (markedOvernight) result.evidence.push({ kind: 'interpretation', text: 'Explicit overnight wording and an earlier end clock identify an endpoint on the following day.' });
        else result.reasons.push('Explicit daily recurrence with an end clock earlier than its start is interpreted as an overnight window ending the following day, including the final named start date.');
      }
      if (explicitNext) result.evidence.push({ kind: 'interpretation', text: 'The schedule explicitly identifies the endpoint as the next day.' });
      for (const day of baseDays) push(day + start.minutes * MINUTE, (endDay ?? day + rollover) + end.minutes * MINUTE, 'minute');
      if (peek('comma') && peek('clock', 1)) { at++; continue; }
      break;
    } while (at < tokens.length);
    if (at < tokens.length && !peek('comma') && !peek('break')) fail('Trailing schedule conditions could change the time windows; nothing is activated.');
  }
  return localPeriods;
}
export function parseTwTimeWindows(text: string, options: TwTimeOptions = {}): TwTimeAnalysis {
  const result: TwTimeAnalysis = { periods: [], confidence: 'unknown', reasons: [], evidence: [], flags: { cancellation: false, amendment: false } };
  if (typeof text !== 'string' || !text.trim()) { result.reasons.push('No schedule text was supplied.'); return result; }
  result.evidence.push({ kind: 'schedule', text });
  if (text.length > 20000) { result.reasons.push('Schedule text exceeds the supported 20,000 characters.'); return result; }
  let normalized = text.normalize('NFKC');
  result.flags.cancellation = /取消|撤銷|撤销|廢止|废止|\bcancel(?:led|ed|lation|s)?\b|\brevoked?\b/i.test(normalized);
  result.flags.amendment = /修正|更正|變更|变更|延期|展延|\bamend(?:ed|ment)?\b|\brevised?\b|\bpostpon(?:ed|ement)\b/i.test(normalized);
  if (result.flags.cancellation || result.flags.amendment) {
    result.reasons.push('Cancellation or amendment wording requires lifecycle/source review; detected wording is not a resolved cancellation state. No schedule is activated.');
    return result;
  }
  if (/發布日期|发布日[期]?|發佈日期|公告日期|刊登日期|發文日期|发文日期|發布時間|发布時間|發布時間|發佈時間|發布|发布|\b(?:issued?|published|publication|posted)\b/i.test(normalized)) {
    result.reasons.push('Publication/issue metadata is not an operational schedule. Pass only the independently extracted schedule field; publication dates are never used as event dates.');
    return result;
  }
  if (/即日起|即刻|另行通知|至另|擇日|择日|待定|暫定|暂定|預備|预备|備用|备用|除外|除.*外|不含|不包括|每週|每周|每星期|工作日|例假日|節假日|节假日|日出|日落|白天|夜間|夜间|\b(?:immediately|effective\s+immediately|until\s+further|except|excluding|tentative|alternate|weekdays?|weekends?|sunrise|sunset|daylight)\b/i.test(normalized)) {
    result.reasons.push('The schedule has relative, conditional, exceptional, or unsupported recurrence wording; explicit dates and complete windows are required.');
    return result;
  }
  try {
    normalized = extractTimezone(normalized, options, result).trim();
    const tokens = tokenize(normalized, options, result);
    const local = parseTokens(tokens, result);
    if (!local.length) fail('No complete operational date/window was found.');
    const precisions = new Set(local.map(p => p.precision));
    result.precision = precisions.size > 1 ? 'mixed' : local[0].precision;
    if (!result.timezone) return result;
    const offset = result.timezone.offsetMinutes * MINUTE;
    const unique = new Map(local.map(p => [`${p.start}/${p.end}`, { ...p, start: p.start - offset, end: p.end - offset, text }]));
    result.periods = [...unique.values()].sort((a, b) => a.start - b.start || a.end - b.end);
    // Reject overlapping windows instead of silently resolving contradictory
    // continuous/daily schedules; identical duplicates have already been removed.
    for (let i = 1; i < result.periods.length; i++) if (result.periods[i].start < result.periods[i - 1].end) fail('Overlapping schedule windows require review; no merge or precedence is inferred.');
    result.confidence = result.evidence.some(e => e.source) ? 'source-convention' : 'explicit';
  } catch (error) {
    result.periods = [];
    result.confidence = 'unknown';
    if (error instanceof Unsupported) result.reasons.push(error.message);
    else throw error;
  }
  result.reasons = [...new Set(result.reasons)];
  result.evidence = result.evidence.filter((e, i, all) => all.findIndex(other => other.kind === e.kind && other.text === e.text && other.source === e.source) === i);
  return result;
}
