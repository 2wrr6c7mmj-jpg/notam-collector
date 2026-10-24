/** Additional activation timing in E must not be replaced by B/C or D alone.
 * This detector does not calculate solar times, local offsets, or balloon drift.
 * It deliberately does not treat changed operating/service hours as D schedules.
 */
export type BodyTimingIssue = { evidence: string; reason: string };
export function bodyActivationTimingIssue(fields: Record<string, string>): BodyTimingIssue | null {
  const body = fields.E ?? '';
  const compact = body.toUpperCase().replace(/\s+/g, ' ');
  const leading = body.match(/^\s*(?:(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?\d{2}\s+\d{4}\s*[-/][\s\S]*?(?=\b(?:TRAINING\s+FLT|DANGER\s+AREA|AIRSPACE\s+CLSD)\b)/i);
  if (leading) return { evidence: leading[0].trim(), reason: 'E欄に活動の日時表があります。B/C欄だけで連続実施とは判定できません。' };
  const label = /\b(?:(?:FLT|FLIGHT|RELEASING)\s+(?:DATE\s+AND\s+)?TIME|DAY\s+AND\s+TIME|TIME\s+AND\s+FLT\s+ALT|SCHEDULE)\s*[:;/]\s*/gi;
  for (const m of body.matchAll(label)) {
    const remainder = body.slice(m.index! + m[0].length);
    const next = remainder.search(/(?:\r?\n|\s)\d{1,2}\.\s*[A-Z][A-Z ]*\s*[:;]/i);
    const value = (next < 0 ? remainder : remainder.slice(0,next)).trim();
    // H24 itself imposes no additional activation window. It is still narrated.
    if (/^H24\b/i.test(value)) continue;
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
  const recurring=new RegExp(String.raw`\b(?:(?:DAILY|DLY)\s+(?:(?:FROM|BETWEEN)\s+)?\(?${pair}|${pair}\s+(?:DAILY|DLY)|${weekday}(?:\s*[- ]\s*${weekday})*\s+${pair})\b`,'i');
  const match=body.match(recurring);
  if (!match) return null;
  return { evidence: match[0], reason: /\dL\b/i.test(match[0])
    ? 'E欄に現地時刻の活動・制限時間があります。現地時刻の基準を確定せずUTC換算していないため、連続実施とは判定できません。'
    : 'E欄に活動・制限の曜日または毎日の時間帯があります。B/C/D欄だけでは実施中と断定できません。' };
}
