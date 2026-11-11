// Reads the monthly schedule table (時段申請表) attached to a firing notice.
//
// The table has one line per day of the month. Army units print the local
// time of each firing and then the same time in UTC; the navy prints one
// column per range (R-18, R-25, ...). Days without firing are blank.
//
// Works on the layout text of the page as extracted, before whitespace is
// collapsed: the navy's columns can only be told apart by where they sit on
// the line.

const TAIPEI_OFFSET_HOURS = 8;

// Republic of China calendar: year 115 is 2026.
export const gregorianYear = rocYear => rocYear + 1911;

// A wall-clock time in Taiwan as an ISO instant. "2400" is the end of the day.
export function taipeiInstant(year, month, day, hhmm) {
  const hours = Math.floor(hhmm / 100),
    minutes = hhmm % 100;
  return new Date(
    Date.UTC(year, month - 1, day, hours - TAIPEI_OFFSET_HOURS, minutes),
  ).toISOString();
}

// Full-width digits to ASCII, and "22 00時" (a time split by the text layer)
// back to "2200時".
const tidy = text =>
  text
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/(?<!\d)(\d{2}) (\d{2}) ?(?=時)/g, '$1$2');

const TITLE = /(\d{3})年(\d{1,2})月份?(?:靶區)?時段申請表/;
const DAY_LINE = /^\s*(\d{1,2})\s+([一二三四五六日])(?=\s|$)/;
const TIME_RANGE = /(?<!\d)([0-2]\d[0-5]\d) ?時? ?[-–~至] ?([0-2]\d[0-5]\d)(?!\d)/g;
const RANGE_NAME = /R ?- ?\d+[A-Z]?/g;

const centre = (index, text) => index + text.length / 2;

const WEEKDAYS = '日一二三四五六';
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// How many day lines carry the weekday that the day has in the given month.
function weekdaysMatching(dayLines, year, month) {
  return dayLines.filter(
    ([, day, weekday]) =>
      +day <= daysIn(year, month) &&
      WEEKDAYS[new Date(Date.UTC(year, month - 1, +day)).getUTCDay()] === weekday,
  ).length;
}

// Null when the page is not a schedule table.
//
// `noticeMonths` lists the months the notice is about, as [year, month]. A
// unit sometimes fills in last month's sheet and leaves its heading: every
// weekday on the table is then wrong for the month in the heading. When they
// are all right for exactly one month the notice is about, the table is read
// as that month's and marked `monthFromWeekdays`.
export function scheduleTable(rawPage, {noticeMonths = []} = {}) {
  const page = tidy(rawPage);
  const title = page.replace(/[ \t]/g, '').match(TITLE);
  if (!title) return null;
  let year = gregorianYear(+title[1]),
    month = +title[2];
  const lines = page.split('\n');
  const dayLines = lines.map(line => line.match(DAY_LINE)).filter(Boolean);
  // A form that only refers to the table ("如115年7月份靶區時段申請表") is not one.
  if (dayLines.length < 10) return null;

  let monthFromWeekdays = false;
  if (weekdaysMatching(dayLines, year, month) === 0) {
    const fitting = noticeMonths.filter(
      ([y, m]) => weekdaysMatching(dayLines, y, m) === dayLines.length,
    );
    if (fitting.length === 1) {
      [[year, month]] = fitting;
      monthFromWeekdays = true;
    }
  }

  // Navy tables: the header line names the ranges, one per column.
  const header = lines.find(line => (line.match(RANGE_NAME) ?? []).length >= 2);
  const columns = header
    ? [...header.matchAll(RANGE_NAME)].map(m => ({
        name: m[0].replace(/ /g, ''),
        at: centre(m.index, m[0]),
      }))
    : null;

  const slots = [];
  for (const line of lines) {
    const dayMatch = line.match(DAY_LINE);
    if (!dayMatch) continue;
    const day = +dayMatch[1];
    if (day < 1 || day > 31) continue;
    const found = [...line.slice(dayMatch[0].length).matchAll(TIME_RANGE)].map(m => ({
      from: +m[1],
      to: +m[2],
      at: dayMatch[0].length + centre(m.index, m[0]),
    }));
    // Army tables repeat each local time in UTC further along the line
    // ("0800-1200 0000-0400"): a range that starts eight hours before an
    // earlier one is that repetition.
    const ranges = columns
      ? found
      : found.filter(
          (range, i) =>
            !found.slice(0, i).some(local => (local.from + 2400 - 800) % 2400 === range.from),
        );
    const reserve = /預備/.test(line);
    for (const range of ranges) {
      if (range.from >= 2400 || range.to > 2400) continue;
      // A firing that ends at or before its start runs past midnight.
      const endDay = range.to <= range.from ? day + 1 : day;
      const column = columns?.reduce((best, c) =>
        Math.abs(c.at - range.at) < Math.abs(best.at - range.at) ? c : best,
      );
      slots.push({
        start: taipeiInstant(year, month, day, range.from),
        end: taipeiInstant(year, month, endDay, range.to),
        ...(reserve ? {reserve: true} : {}),
        ...(column ? {range: column.name} : {}),
      });
    }
  }
  return {
    year,
    month,
    ...(monthFromWeekdays ? {monthFromWeekdays} : {}),
    ...(columns ? {ranges: columns.map(c => c.name)} : {}),
    slots,
  };
}
