// Evidence extractor: candidates never directly become notice periods or shapes.
// The runtime adapter independently validates the supported area/time family.
// Input pages must retain the layout and page boundaries of the PDF text layer.
const norm = s => s.normalize('NFKC').replace(/[’′´]/g, "'").replace(/[”″〞]/g, '"');
const DAY = 86400000;
export function rocDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger) || year < 1 || year > 999) return null;
  const y = year + 1911, t = Date.UTC(y, month - 1, day), d = new Date(t);
  return d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    ? d.toISOString().slice(0, 10) : null;
}
function clockMinutes(s, end = false) {
  const m = s.match(/^(\d{2}):?(\d{2})$/);
  if (!m || +m[2] > 59 || +m[1] > 24 || (+m[1] === 24 && (!end || +m[2]))) return null;
  return +m[1] * 60 + +m[2];
}
// Explicit UTC/GMT evidence only. L and unspecified clocks never imply UTC+8.
// End-day rollover requires 24:00, an explicit end date, or an explicit next-day flag.
export function utcWindow({date, endDate = date, startClock, endClock, zone, nextDay = false}) {
  if (!['UTC', 'GMT'].includes(zone)) return null;
  const day = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(Date.parse(s)).toISOString().slice(0,10) === s;
  if (!day(date) || !day(endDate) || (nextDay && endDate !== date)) return null;
  const a = clockMinutes(startClock), b = clockMinutes(endClock, true);
  if (a === null || b === null) return null;
  const start = Date.parse(date) + a * 60000, end = Date.parse(endDate) + b * 60000 + (nextDay ? DAY : 0);
  return end > start ? {start: new Date(start).toISOString(), end: new Date(end).toISOString()} : null;
}
export function coordinate(raw) {
  const s = norm(raw).replace(/\s/g, '');
  let m = s.match(/^(\d{1,3}(?:\.\d+)?)°(?:(\d{1,2}(?:\.\d+)?)'(?:(\d{1,2}(?:\.\d+)?)")?)?([NSEW])$/);
  let deg, min = 0, sec = 0, hemisphere, format;
  if (m) {
    deg = +m[1]; min = +(m[2] || 0); sec = +(m[3] || 0); hemisphere = m[4];
    if ((m[2] && m[1].includes('.')) || (m[3] && m[2].includes('.'))) return null;
    format = m[3] ? 'DMS' : m[2] ? 'DM' : 'decimal-degrees';
  } else {
    m = s.match(/^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/);
    if (!m || m[1].length !== (/[NS]/.test(m[4]) ? 2 : 3)) return null;
    deg = +m[1]; min = +m[2]; sec = +m[3]; hemisphere = m[4]; format = 'compact-DMS';
  }
  const limit = /[NS]/.test(hemisphere) ? 90 : 180, value = deg + min / 60 + sec / 3600;
  if (min >= 60 || sec >= 60 || value > limit) return null;
  return {value: value * (/[SW]/.test(hemisphere) ? -1 : 1), axis: /[NS]/.test(hemisphere) ? 'lat' : 'lon', format, raw};
}
const tokenPattern = /\d{1,3}(?:\.\d+)?\s*°\s*(?:\d{1,2}(?:\.\d+)?\s*'\s*(?:\d{1,2}(?:\.\d+)?\s*"\s*)?)?[NSEW]|\b\d{6,7}(?:\.\d+)?[NSEW]\b/g;
function geometry(text) {
  const labels = [...text.matchAll(/\b([A-Z])\s*[:(]\s*(?=\d)/g)];
  if (!labels.length) return {polygon: null, issue: 'unrecognized-coordinate-layout'};
  const points = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i][1] !== String.fromCharCode(65 + i)) return {polygon: null, issue: 'duplicate-or-nonsequential-point-labels'};
    const start = labels[i].index + labels[i][0].length;
    const section = text.slice(start, Math.min(labels[i+1]?.index ?? text.length, start + 180));
    const tokens = [...section.matchAll(tokenPattern)].slice(0, 2);
    const pair = tokens.map(t => coordinate(t[0]));
    if (pair.length !== 2 || pair.some(x => !x) || pair[0].axis === pair[1].axis) return {polygon: null, issue: 'invalid-coordinate-or-hemisphere'};
    points.push({label: labels[i][1], lat: pair.find(x => x.axis === 'lat').value, lon: pair.find(x => x.axis === 'lon').value, evidence: tokens.map(x => x[0]), formats: pair.map(x=>x.format)});
  }
  if (points.length < 3 || points.length > 12 || new Set(points.map(p=>`${p.lat},${p.lon}`)).size !== points.length) return {polygon: null, issue: 'invalid-polygon-points'};
  if (!/WGS\s*84/.test(text)) return {polygon: null, issue: 'datum-unverified', pointEvidence: points};
  return {polygon: {datum:'WGS84', points}, issue: null};
}
function monthlyTable(text) {
  if (!/月份.*時段申請表/.test(text)) return null;
  const ym = text.match(/(\d{3})\s*年\s*(\d{1,2})\s*月份/);
  if (!ym) return {windows: [], issue: 'table-year-month-unverified'};
  const naval = /R-18\s+R-25\s+R-27\s+R-39/.test(text);
  const greenwich = /射擊時間\s+(?:協調時間\(格林威治時間\)|格林威治標準時間)/.test(text);
  if (!naval && !greenwich) return {windows: [], issue: 'table-columns-unrecognized'};
  const windows = [], days = new Set();
  for (const line of text.split('\n')) {
    const row = line.match(/^\s*(\d{2})\s+[一二三四五六日]\s*(.*?)\s*$/);
    if (!row) continue;
    if (days.has(row[1])) return {windows: [], issue:'duplicate-table-day'};
    days.add(row[1]);
    if (!row[2]) continue; // Blank dates stay blank (no forward filling).
    const date = rocDate(+ym[1], +ym[2], +row[1]);
    const cells = [...row[2].matchAll(/(\d{4})\s*時?\s*-\s*(\d{4})\s*時?\s*(\(\s*預備日\s*\))?/g)];
    const residue = row[2].replace(/(\d{4})\s*時?\s*-\s*(\d{4})\s*時?\s*(\(\s*預備日\s*\))?/g,'').trim();
    if (!date || residue || cells.length !== (naval ? 4 : 2) || cells.some(c=>clockMinutes(c[1])===null || clockMinutes(c[2],true)===null || +c[2]<=+c[1])) return {windows: [], issue:'ambiguous-or-invalid-table-row', raw:line};
    cells.forEach((c,i) => {
      const zone = greenwich && i === 1 ? 'GMT' : 'unverified';
      windows.push({date, startClock:c[1], endClock:c[2], zone, role:naval?'application':i===0?'firing':/協調時間/.test(text)?'coordination':'standard-time', area:naval?['R-18','R-25','R-27','R-39'][i]:null, reserve:!!c[3], raw:line,
        ...(zone === 'GMT' ? {utcEvidence:utcWindow({date,startClock:c[1],endClock:c[2],zone})}: {})});
    });
  }
  return {windows, issue:windows.length ? null : 'empty-table'};
}
function ncsistWindows(text) {
  if (!/FT-009/.test(text) || !/執行時間/.test(text)) return null;
  const block = text.split('執行目的')[1]?.split('執行/射擊地點')[0];
  if (!block || /預備|除外|取消|每日|翌|次日|~|至\s*\d+\s*日/.test(block)) return {windows:[],issue:'unsupported-calendar-qualifier'};
  const dates = [...block.matchAll(/(\d{3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2}(?:\s*、\s*\d{1,2})*)\s*日/g)];
  const times = [...block.matchAll(/自\s*(\d{2}:\d{2})L\s*至\s*(\d{2}:\d{2})L\s*止/g)];
  const windows = [];
  if (!dates.length || !times.length) return {windows,issue:'unrecognized-execution-window'};
  for (const d of dates) for (const day of d[3].split('、')) for (const t of times) {
    const date = rocDate(+d[1],+d[2],+day);
    if (!date || clockMinutes(t[1])===null || clockMinutes(t[2],true)===null || clockMinutes(t[2],true)<=clockMinutes(t[1])) return {windows:[],issue:'invalid-execution-window'};
    windows.push({date,startClock:t[1],endClock:t[2],zone:'L-unverified',role:'execution',reserve:false,raw:`${d[0]} ${t[0]}`});
  }
  return {windows,issue:null};
}
export function extractTaiwanPdfEvidence({sourceUrl, pdfSha256, pages}) {
  if (!/^https:\/\/www\.fa\.gov\.tw\//.test(sourceUrl) || !/^[a-f0-9]{64}$/.test(pdfSha256) || !Array.isArray(pages) || pages.length > 50 || pages.some(p=>typeof p!=='string'||p.length>200000)) throw Error('Bounded PDF pages and source provenance required');
  const results = pages.map((raw,page) => {
    const text = norm(raw), g = geometry(text), table = monthlyTable(text), time = table || ncsistWindows(text);
    const radii = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:浬\s*\(NM\)|NM\b)/g)].map(m=>({nauticalMiles:+m[1],raw:m[0],interpretation:'source-radius-only-not-a-circle'}));
    return {page:page+1, reviewNeeded:true, issues:[...(!text.trim()?['no-text-layer-ocr-or-review-needed']:[]),...(g.issue?[g.issue]:[]),...(time?.issue?[time.issue]:[]),...(!time?['unrecognized-time-layout']:[]),'publication-and-cancellation-review-required','polygon-radius-and-time-association-review-required'], polygonEvidence:g.polygon, ...(g.pointEvidence?{pointEvidence:g.pointEvidence}:{}), radiusEvidence:radii,
      sourceWindows:time?.windows||[], rawText:raw};
  });
  // Evidence is deliberately outside the Notice schema. Never invent active geometry/time.
  return {schemaVersion:1, kind:'taiwan-pdf-review-evidence', sourceUrl,pdfSha256,reviewNeeded:true, shapes:[],validityPeriods:[],start:null,end:null,pages:results};
}

