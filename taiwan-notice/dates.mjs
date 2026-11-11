// Reads firing dates written out in a sentence: on the notification form
// ("射擊日期 115年8月10、11、12日,0500-0700時 (11、12日為預備日)"), in the
// notice to mariners ("說明:115年12月16、17日在下列位址…") and in titles.
//
// Years are Republic of China years, times are Taiwan time. Expects text
// that went through normalizeNoticeText.
import {gregorianYear, taipeiInstant} from './schedule.mjs';

const YEAR_MONTH = /(?<!\d)(1[0-3]\d) ?年 ?(\d{1,2}) ?月(?!份)/g;
// The layout text of a form runs columns together, so words from the
// neighbouring column may sit between the parts of a date.
const FILLER = /[^\d\n]{0,30}(?:\n[^\d\n]{0,30})?/y;
// A number followed by 月 or 年 is the month or year of the next date
// ("114年10月(取消)--…10月14日", "3月下旬及4月上旬"), not a day of this one.
const DAY =
  /(\d{1,2})(?!\d| ?[月年])\s{0,3}(?:日 ?)?(?:(?:[-~]|至) ?(\d{1,2})(?!\d)\s{0,3})?日? ?(\(預備日\))?(?:\([^)\d]{1,4}\))?/y;
const SEPARATOR = /\s*(?:[、,，]|及|和|與)\s*/y;
const NEXT_MONTH = /(\d{1,2}) ?月 ?/y;
// "計3日" after a list is the number of days, not another day; "(刪除)12" in
// an amended notice strikes the 12th.
const DAY_COUNT = /計 ?$/;
// A number at the start of a line is a day only when the list goes on after
// it; otherwise it is the row number of the distribution list beside the date.
const LINE_START = /(?:^|\n)[ \t]*$/;
const LIST_GOES_ON = /^\s*(?:日|[、,，]|[-~]|至|及|和|\()/;
const DAY_WITH_MARK = /^\d{1,2}\s{0,3}日/;
const STRUCK = /\(刪除\) ?$/;
const TIME_GAP = String.raw`(?:[-–~]|至)[^\d]{0,30}?`;
const TIMES = [
  new RegExp(String.raw`^([0-2]\d)([0-5]\d) ?時? ?${TIME_GAP}([0-2]\d)([0-5]\d)(?!\d)`),
  // "06:00L至07:50L": L marks local time.
  /^([0-2]?\d):([0-5]\d) ?L? ?(?:[-–~]|至) ?([0-2]?\d):([0-5]\d)/,
  /^([0-2]?\d)() ?時 ?(?:[-–~]|至) ?([0-2]?\d)() ?時/,
  /^([0-2]?\d)()-([0-2]?\d)() ?時/,
];
// Between the days and their times: punctuation, words of the neighbouring
// column, "每日", the number of days ("計3日").
const WORDS = String.raw`(?:(?!共?計)[^\d\n]){0,24}`;
const BEFORE_TIME = new RegExp(
  String.raw`^[\s,，:：。;]*${WORDS}(?:\n${WORDS})?(?:(?:每 ?日|共?計 ?\d+ ?日)[\s,，]*)*${WORDS}`,
);
const AFTER_TIME = /^ ?(?:時|\n[^\d\n(]{0,24}時)?(?:止)? ?(\(預備日\))?/;
const MORE_TIMES = /^ ?[、,，及] ?/;
const MORE_DAYS = /[、,，;。]?\s*/y;
const RESERVE_NOTE = /\(?((?:\d{1,2}[\s、,，及]*)+)日? ?為 ?預備日/;
// The date a letter was issued, the date of a document it cites, or the term
// of a launch permit ("效期為115年4月28日起至116年4月27日止").
const NOT_A_FIRING_DATE_BEFORE = /(?:中 ?華 ?民 ?國|發文(?:日期|字號)[:：]?|依據?|奉)\s?$/;
const PERMIT_TERM_BEFORE = /效期為?\s?$/;
const PERMIT_TERM_LENGTH = 40; // "115年4月28日起至116年4月27日止
const NOT_A_FIRING_DATE_AFTER = /^[^\n]{0,24}(?:字第|號函|函辦理)/;

const at = (pattern, text, index) => {
  pattern.lastIndex = index;
  return pattern.exec(text);
};

// `continued` is set for a list that follows the times of an earlier one;
// such a list has to name its day ("15日"), bare numbers there are something
// else ("計 7日", "2.115年…").
function readDays(text, start, year, month, continued = false) {
  const days = [];
  let index = start;
  for (;;) {
    const skipped = at(FILLER, text, index);
    const day = at(DAY, text, index + skipped[0].length);
    if (!day) break;
    const lead = text.slice(Math.max(0, day.index - 8), day.index);
    if (DAY_COUNT.test(lead)) break;
    if (continued && !days.length && !DAY_WITH_MARK.test(day[0])) break;
    if (
      LINE_START.test(text.slice(Math.max(0, day.index - 40), day.index)) &&
      !/日/.test(day[0]) &&
      !LIST_GOES_ON.test(text.slice(day.index + day[0].length, day.index + day[0].length + 4))
    )
      break;
    const first = +day[1],
      last = day[2] === undefined ? first : +day[2];
    if (first < 1 || last > 31 || last < first) break;
    if (!STRUCK.test(skipped[0]))
      for (let d = first; d <= last; d++)
        days.push({year, month, day: d, ...(day[3] ? {reserve: true} : {})});
    index = day.index + day[0].length;
    const separator = at(SEPARATOR, text, index);
    if (!separator) break;
    const afterSeparator = separator.index + separator[0].length;
    const nextMonth = at(NEXT_MONTH, text, afterSeparator);
    if (nextMonth && +nextMonth[1] >= 1 && +nextMonth[1] <= 12) {
      if (+nextMonth[1] < month) year++;
      month = +nextMonth[1];
      index = nextMonth.index + nextMonth[0].length;
    } else index = afterSeparator;
  }
  return {days, end: index, year, month};
}

// The time ranges that follow a list of days, e.g. ",每日0530-0730、2050-2250時".
function readTimes(text, start) {
  const times = [];
  const window = text.slice(start, start + 160);
  let rest = window.replace(BEFORE_TIME, ''),
    reserve = false;
  for (;;) {
    const match = TIMES.map(pattern => rest.match(pattern)).find(Boolean);
    if (!match) break;
    const from = +match[1] * 100 + +(match[2] || 0),
      to = +match[3] * 100 + +(match[4] || 0);
    if (from > 2400 || to > 2400) break;
    times.push({from, to});
    rest = rest.slice(match[0].length);
    const tail = rest.match(AFTER_TIME);
    if (tail[1]) reserve = true;
    rest = rest.slice(tail[0].length);
    // The reserve mark closes the list; otherwise another range may follow.
    const more = tail[1] ? null : rest.match(MORE_TIMES);
    if (!more) break;
    rest = rest.slice(more[0].length).replace(/^\s+/, '');
  }
  return {times, reserve, end: times.length ? start + window.length - rest.length : start};
}

// Every list of firing days in the text, with the times that follow it. One
// sentence may give several lists, each with its own times
// ("2、3日 0900-1700時 15日 0900-1130時").
export function datePhrases(text) {
  const phrases = [];
  let permitTermEnds = 0;
  for (const match of text.matchAll(YEAR_MONTH)) {
    if (+match[2] < 1 || +match[2] > 12) continue;
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (PERMIT_TERM_BEFORE.test(before)) permitTermEnds = match.index + PERMIT_TERM_LENGTH;
    if (match.index < permitTermEnds) continue;
    if (NOT_A_FIRING_DATE_BEFORE.test(before)) continue;
    const allReserve = /預備日[:：]? ?$/.test(before);
    let year = gregorianYear(+match[1]),
      month = +match[2],
      index = match.index + match[0].length;
    for (let continued = false; ; continued = true) {
      const list = readDays(text, index, year, month, continued);
      if (!list.days.length) break;
      const after = text.slice(list.end, list.end + 120);
      if (NOT_A_FIRING_DATE_AFTER.test(after)) break;
      const timed = readTimes(text, list.end);
      const reserveDays = new Set(after.match(RESERVE_NOTE)?.[1].match(/\d+/g)?.map(Number) ?? []);
      phrases.push({
        index: match.index,
        days: list.days.map(day =>
          allReserve || timed.reserve || reserveDays.has(day.day) ? {...day, reserve: true} : day,
        ),
        times: timed.times,
      });
      // Only a list that came with its own times can be followed by another.
      if (!timed.times.length) break;
      ({year, month} = list);
      index = timed.end + at(MORE_DAYS, text, timed.end)[0].length;
    }
  }
  return phrases;
}

// The fleet command writes "1116/1200-1600": 16 November, 1200 to 1600, or
// "1006/0800-1007/0759" when the end falls on another day. The year is not
// printed.
const COMPACT =
  /(?<![\d/])(0[1-9]|1[0-2])([0-3]\d)\/([0-2]\d[0-5]\d) ?- ?(?:(0[1-9]|1[0-2])([0-3]\d)\/)?([0-2]\d[0-5]\d)(?![\d/])/g;
// Its air exercise form writes "115.3.17" with the time on the next line.
const DOTTED =
  /(?<![\d.])(1[0-3]\d)\.(\d{1,2})\.(\d{1,2})(?![\d.])(?:[ \t]*|[^\n]{0,80}\n[ \t]*)([0-2]\d[0-5]\d) ?- ?([0-2]\d[0-5]\d)(?!\d)/g;

// The space agency writes Gregorian dates: "2026/07/26 13:30-18:00".
const GREGORIAN =
  /(?<![\d/])(20\d\d)\/(\d{1,2})\/(\d{1,2}) ?([0-2]?\d):([0-5]\d) ?[-~] ?([0-2]?\d):([0-5]\d)(?!\d)/g;

// The test ranges print the hours in a box of their own, away from the days,
// with L for local time: "自08:00L 至 17:00L 止", or one line per session
// ("08:00L 至 12:00L", "13:00L 至 17:00L"). They give the hours of the days on
// that page that came without any.
const STANDING_HOURS = /([0-2]?\d):([0-5]\d) ?L ?(?:至|[-~]) ?([0-2]?\d):([0-5]\d) ?L/g;
function standingHours(text) {
  const found = new Map();
  for (const [, h1, m1, h2, m2] of text.matchAll(STANDING_HOURS))
    found.set(`${+h1}:${m1}-${+h2}:${m2}`, {from: +h1 * 100 + +m1, to: +h2 * 100 + +m2});
  return [...found.values()];
}

const validDay = (month, day) => month >= 1 && month <= 12 && day >= 1 && day <= 31;
const validTime = hhmm => hhmm <= 2400 && hhmm % 100 < 60;

const slot = (year, month, day, from, to, extra) => ({
  start: taipeiInstant(year, month, day, from),
  // A firing that ends at or before its start runs past midnight.
  end: taipeiInstant(year, month, to <= from ? day + 1 : day, to),
  ...extra,
});

// The dates in the text as time slots in UTC. A day without a stated time is
// the whole day in Taiwan and is marked so. `year` (Gregorian) is used for
// dates printed without one.
export function dateSlots(text, {year} = {}) {
  const slots = [];
  const standing = standingHours(text);
  for (const phrase of datePhrases(text)) {
    const {days} = phrase;
    // The first session may sit right after the days and be read with them;
    // the box then has that session and more.
    const boxHasMore =
      standing.length > phrase.times.length &&
      phrase.times.every(t => standing.some(s => s.from === t.from && s.to === t.to));
    const times = boxHasMore ? standing : phrase.times;
    for (const day of days) {
      const extra = {
        ...(day.reserve ? {reserve: true} : {}),
        ...(times.length ? {} : {wholeDay: true}),
      };
      for (const {from, to} of times.length ? times : [{from: 0, to: 2400}])
        slots.push(slot(day.year, day.month, day.day, from, to, extra));
    }
  }
  for (const [, rocYear, month, day, from, to] of text.matchAll(DOTTED))
    if (validDay(+month, +day) && validTime(+from) && validTime(+to))
      slots.push(slot(gregorianYear(+rocYear), +month, +day, +from, +to, {}));
  for (const [, fullYear, month, day, h1, m1, h2, m2] of text.matchAll(GREGORIAN)) {
    const from = +h1 * 100 + +m1,
      to = +h2 * 100 + +m2;
    if (validDay(+month, +day) && validTime(from) && validTime(to))
      slots.push(slot(+fullYear, +month, +day, from, to, {}));
  }
  if (year)
    for (const [, month, day, from, endMonth, endDay, to] of text.matchAll(COMPACT)) {
      if (!validDay(+month, +day) || !validTime(+from) || !validTime(+to)) continue;
      if (endMonth === undefined) slots.push(slot(year, +month, +day, +from, +to, {}));
      // "0822/1400-0822/0759" in a list where every other line ends the next
      // morning: the end day was typed as the start day.
      else if (endMonth === month && endDay === day && +to <= +from)
        slots.push(slot(year, +month, +day, +from, +to, {}));
      else if (validDay(+endMonth, +endDay))
        slots.push({
          start: taipeiInstant(year, +month, +day, +from),
          end: taipeiInstant(+endMonth < +month ? year + 1 : year, +endMonth, +endDay, +to),
        });
    }
  return slots;
}

// The Gregorian year a notice is about, from the first Republic of China
// year it mentions.
// The months a text names, as [Gregorian year, month], without repeats.
export function monthsNamed(text) {
  const months = new Map();
  for (const [, rocYear, month] of text.matchAll(/(?<!\d)(1[0-3]\d) ?年 ?(\d{1,2}) ?月/g))
    if (+month >= 1 && +month <= 12)
      months.set(`${rocYear}-${month}`, [gregorianYear(+rocYear), +month]);
  return [...months.values()];
}

export function noticeYear(text) {
  const match = text.match(/(?<!\d)(1[0-3]\d) ?年/);
  return match ? gregorianYear(+match[1]) : null;
}
