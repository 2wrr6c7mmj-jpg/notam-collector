/** Additional activation timing in E must not be replaced by B/C or D alone.
 * This detector does not calculate solar times, local offsets, or balloon drift.
 * It deliberately does not treat changed operating/service hours as D schedules.
 */
export type BodyTimingIssue = { evidence: string; reason: string };
/** Extract one wholly supported activation clause, never just its clock tokens. */
export function supportedBodySchedule(fields:Record<string,string>):string|null {
 if([...(fields.E||'').matchAll(/\b(?:(?:FLT|FLIGHT|RELEASING)\s+(?:DATE\s+AND\s+)?TIME|DAY\s+AND\s+TIME|SCHEDULE)\s*[:;/]/gi)].length>1)return null;
 const issue=bodyActivationTimingIssue(fields);if(!issue)return null;
 if(/RELEASING|BALLOON|\b(?:SR|SS|HJ|HN|EXC|EXCEPT|HOL|LOCAL|LT)\b|\dL\b/i.test(issue.evidence)||/\bBALLOONS?\b/i.test(fields.E||''))return null;
 const evidence=issue.evidence.split(/\r?\n/)[0].trim();
 const remaining=(fields.E||'').replace(evidence,'');
 // A daily clause cannot erase an extra single-clock qualification.
 if(/\b(?:UNTIL|TILL|BEFORE|AFTER|FROM|BY|NO\s+LATER\s+THAN|NOT\s+EARLIER\s+THAN|START(?:S|ING)?(?:\s+AT)?|END(?:S|ING)?(?:\s+AT)?)\s*[:;]?\s*(?:AT\s+)?\d{2}:?\d{2}(?:Z|\s*(?:UTC|JST|LT))?\b/i.test(remaining))return null;
 // Residual recurrence/exception language must not be discarded either.
 if(/\b(?:EXCLUDING|EXCEPTIONS?|WEEKENDS?|WEEKDAYS?|ALTERNATE|ODD|EVEN|EVERY|HOURS?|MINUTES?|DAYS?|WEEKS?|MONTHS?|YEARS?)\b|\bON\s+\d{1,2}\b/i.test(remaining))return null;
 // Residual calendar, timezone, solar or clock text needs a complete parser.
 if(/\b(?:LOCAL|LT|JST|UTC|SUNRISE|SUNSET|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b|\b\d{4}[ZL]\b|\b\d{4}[ZL]?\s+(?:TO|UNTIL|AND)\s+\d{4}[ZL]?\b/i.test(remaining))return null;
 // Consume only the clause actually parsed. Later restrictions may narrow it.
 if(bodyActivationTimingIssue({...fields,E:remaining})||/\b(?:(?<![\d-])\d{4}[ZL]?\s*[-/]\s*\d{4}(?![\d-])|SR|SS|HJ|HN|EXC|EXCEPT|HOL|MON|TUE|WED|THU|FRI|SAT|SUN)\b/i.test(remaining))return null;
 let value=evidence.replace(/^(?:(?:FLT|FLIGHT)\s+(?:DATE\s+AND\s+)?TIME|DAY\s+AND\s+TIME|TIME\s+AND\s+FLT\s+ALT|SCHEDULE|TIME)\s*[:;/]\s*/i,'');
 // Explicit UTC daily prose is a complete recurrence, not merely clock tokens.
 const explicitUtc=/\d{4}Z\b|\bUTC\b/i.test(value);
 value=value.toUpperCase().replace(/\bDLY\b/g,'DAILY').replace(/(\d{4})Z\b/g,'$1').trim();
 if(explicitUtc){
  value=value.replace(/^DAILY\s+(?:FROM|BETWEEN)\s+/,'DAILY ').replace(/\s+UTC\b/g,'').replace(/\s*[-/]\s*/g,'/');
  if(/^(?:\d{4}[-/]\d{4})\s+DAILY$/.test(value))value='DAILY '+value.replace(/\s+DAILY$/,'');
 }
 // Multiline schedules need a parser of the whole table, not its first row.
 if(issue.evidence.includes('\n')&&/^(?:\s*(?:\d|DAILY|MON|TUE|WED|THU|FRI|SAT|SUN|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))/i.test(issue.evidence.slice(issue.evidence.indexOf('\n')+1)))return null;
 if(!/^(?:(?:DAILY|(?:MON|TUE|WED|THU|FRI|SAT|SUN)(?:[- ](?:MON|TUE|WED|THU|FRI|SAT|SUN))*)\s+)?\d{4}[-/]\d{4}(?:\s+\d{4}[-/]\d{4})*$/.test(value))return null;
 return value;
}
export function bodyActivationTimingIssue(fields: Record<string, string>): BodyTimingIssue | null {
  const body = fields.E ?? '';
  const compact = body.toUpperCase().replace(/\s+/g, ' ');
  // A single explicit endpoint can narrow a clock pair just as much as another pair.
  // Do not reinterpret altitude quantities such as FROM 1000FT as clocks.
  const endpoint = body.match(/\b(?:UNTIL|TILL|BEFORE|AFTER|FROM|BY|NO\s+LATER\s+THAN|NOT\s+EARLIER\s+THAN|START(?:S|ING)?(?:\s+AT)?|END(?:S|ING)?(?:\s+AT)?)\s*[:;]?\s*(?:AT\s+)?\d{2}:?\d{2}(?:Z|\s*(?:UTC|JST|LT))?\b/i);
  if(endpoint&&/\b(?:FLT|FLIGHT|UAS|SUAS|UNMANNED|FIRING|FRNG|GUNNERY|EXERCISE|TRAINING|CLSD|CLOSED|RESTRICTED)\b/.test(compact))return {evidence:endpoint[0],reason:'E contains an unresolved single-clock start or end constraint.'};
  const leading = body.match(/^\s*(?:(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?\d{2}\s+\d{4}\s*[-/][\s\S]*?(?=\b(?:TRAINING\s+FLT|DANGER\s+AREA|AIRSPACE\s+CLSD)\b)/i);
  if (leading) return { evidence: leading[0].trim(), reason: 'E欄に活動の日時表があります。B/C欄だけで連続実施とは判定できません。' };
  const label = /\b(?:(?:FLT|FLIGHT|RELEASING)\s+(?:DATE\s+AND\s+)?TIME|DAY\s+AND\s+TIME|TIME\s+AND\s+FLT\s+ALT|SCHEDULE)\s*[:;/]\s*/gi;
  for (const m of body.matchAll(label)) {
    const remainder = body.slice(m.index! + m[0].length);
    const next = remainder.search(/(?:\r?\n|\s)\d{1,2}\.\s*[A-Z][A-Z ]*\s*[:;]/i);
    const value = (next < 0 ? remainder : remainder.slice(0,next)).trim();
    // H24 itself imposes no additional activation window. It is still narrated.
    if (/^H24\s*[.]?$/i.test(value)) continue;
    if (/^H24\b/i.test(value)) return {evidence:m[0]+value,reason:'H24 has additional unresolved conditions.'};
    if (!/\b(?:\d{4}|[0-3]?\d(?:ST|ND|RD|TH)|HJ|HN|SR|SS|MON|TUE|WED|THU|FRI|SAT|SUN)\b/i.test(value)) continue;
    const evidence = m[0] + value;
    return { evidence: evidence.trim(), reason: /\b(?:HJ|HN|SR|SS)\b/i.test(value)
      ? 'E欄に日出・日没による実施条件があります。日付・地点別の太陽時刻を計算していないため、B/C/D欄だけでは実施中と断定できません。'
      : /RELEASING/i.test(m[0])
      ? 'E欄に放球時刻の指定があります。放球とその後の浮遊時間を含む活動時間は未確定です。'
      : 'E欄に追加の実施日時指定があります。B/C/D欄だけでは実施中と断定できません。' };
  }
  // Generic TIME is only an activation label in a clearly identified flight event.
  if (/\b(?:AEROBATICS|PJE|GROUP FLT|UNMANNED|SUAS|UAS|BALLOONS?)\b/.test(compact)) {
    const m=body.match(/\bTIME\s*:\s*(?:(?:\d{4}|SR|SS)\s*[-/]\s*(?:\d{4}|SR|SS)|HJ|HN)\b/i);
    if(m)return {evidence:m[0],reason:'E欄に飛行の実施時間指定があります。B/C/D欄だけでは実施中と断定できません。'};
  }
  // Require an actual activity/restriction, and a syntactically valid clock pair.
  // Never match telephone numbers or arbitrary mentions of TIME / PRIOR / EXC.
  const activity = /\b(?:CLSD|CLOSED|RESTRICTED|UNMONITORED|MOWING|WORKING|CONSTRUCTION|UAS|SUAS|UNMANNED|FIRING|FRNG|GUNNERY|EXERCISE|TRAINING)\b/;
  if (!activity.test(compact)) return null;
  const clock=String.raw`(?:[01]\d|2[0-3])[0-5]\d[ZL]?`;
  const pair=String.raw`${clock}\s*[-/]\s*${clock}`;
  const weekday=String.raw`(?:MON|TUE|WED|THU|FRI|SAT|SUN)`;
  // A recurrence keyword distinguishes malformed clocks from phone numbers.
  const recurringPair=String.raw`\d{4}[ZL]?\s*[-/]\s*\d{4}[ZL]?`;
  const recurring=new RegExp(String.raw`\b(?:(?:DAILY|DLY)\s+(?:(?:FROM|BETWEEN)\s+)?\(?${recurringPair}|${recurringPair}\s+(?:DAILY|DLY)|${weekday}(?:\s*[- ]\s*${weekday})*\s+${recurringPair})\b`,'i');
  const match=body.match(recurring);
  if (!match) {
    const timedLine=body.split(/\r?\n/).find(line=>new RegExp(String.raw`\b${pair}\b`,'i').test(line));
    return timedLine?{evidence:timedLine,reason:'E欄に活動時刻があります。日付や条件との対応を確定できません。'}:null;
  }
  return { evidence: match[0], reason: /\dL\b/i.test(match[0])
    ? 'E欄に現地時刻の活動・制限時間があります。現地時刻の基準を確定せずUTC換算していないため、連続実施とは判定できません。'
    : 'E欄に活動・制限の曜日または毎日の時間帯があります。B/C/D欄だけでは実施中と断定できません。' };
}
