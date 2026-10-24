import {normalizeNotamScheduleSyntax} from "./notam-schedule-normalize";
import {bodyActivationTimingIssue} from "./notam-body-timing";
import {notamFields} from "./notam-fields";
/** Deterministic NOTAM schedule subset. UTC throughout; never evaluates unsupported syntax as active. */
export type SchedulableNotice = { text: string; start: number | null; end: number | null; permanent?: boolean; cancelled?: boolean; lifecycleUncertain?: boolean };
export type ScheduleDiagnostic = { status: 'supported' | 'unsupported' | 'continuous'; raw: string; reason?: string };
type Rule = { month?: number; days?: number[]; weekdays?: number[]; times: [number, number][] };
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
function parse(n: SchedulableNotice): { diagnostic: ScheduleDiagnostic; rules: Rule[] } {
  const raw = notamFields(n.text).D ?? '';
  const fail = (reason: string) => ({ diagnostic: { status: 'unsupported' as const, raw, reason }, rules: [] });
  if (!raw) return { diagnostic: { status: 'continuous', raw }, rules: [] };
  let text = raw.toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (/\b(?:EXC|EXCEPT|SR|SS|HJ|HN|HOL|LOCAL|LT|UTC[+-])\b/.test(text)) return fail('例外・日出日没・休日・現地時間を含むため自動判定対象外');
  text=normalizeNotamScheduleSyntax(text);
  let inheritedMonth: number | undefined;
  const rules: Rule[] = [];
  // Date groups must be comma-separated; rejecting otherwise is intentional.
  for (const part of text.split(',').map(p => p.trim())) {
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
    const month = selector.match(/^([A-Z]{3})\s+/);
    if (month && MONTHS.includes(month[1])) { inheritedMonth = MONTHS.indexOf(month[1]); selector = selector.slice(month[0].length); }
    if (/^(?:SUN|MON|TUE|WED|THU|FRI|SAT)(?:\b|-)/.test(selector)) {
      const days = list(selector, WEEK); if (!days) return fail('曜日の書式を解析できません');
      rule.weekdays = days;
    } else {
      const days = list(selector); if (!days) return fail('日付の書式を解析できません');
      let monthNumber = inheritedMonth;
      if (monthNumber === undefined) {
        if (n.start === null || n.end === null) return fail('月が省略され、有効期間から月を確定できません');
        const a = new Date(n.start), b = new Date(n.end - 1);
        if (a.getUTCFullYear() !== b.getUTCFullYear() || a.getUTCMonth() !== b.getUTCMonth()) return fail('月を省略した日付が複数月にまたがり曖昧です');
        monthNumber = a.getUTCMonth();
      }
      if (n.start === null || n.end === null || n.end - n.start > 366 * DAY) return fail('日付指定の年を確定できません');
      rule.month = monthNumber; rule.days = days;
    }
    rules.push(rule);
  }
  return { diagnostic: { status: 'supported', raw }, rules };
}
export function scheduleDiagnostics(n: SchedulableNotice): ScheduleDiagnostic {
  const fields = notamFields(n.text);
  if(n.lifecycleUncertain)return {status:"unsupported",raw:fields.D || "",reason:"取消し・置換の発出時刻を確定できません"};
  if (["B","C","D"].some(key=>/\[DUPLICATE/.test(fields[key] || ""))) return {status:"unsupported",raw:fields.D || "",reason:"日時欄が重複しています。どの区域・期間に対応するか確定できません"};
  if (n.start === null || !Number.isFinite(n.start) || (!n.permanent && (n.end === null || !Number.isFinite(n.end)))) return { status: 'unsupported', raw: fields.D ?? '', reason: '有効期間B/Cを確定できません' };
  if (n.end !== null && n.end <= n.start) return { status: 'unsupported', raw: fields.D ?? '', reason: '有効期間の開始・終了が逆転または同一です' };
  const bodyIssue=bodyActivationTimingIssue(fields);
  if(bodyIssue) return {status:"unsupported",raw:bodyIssue.evidence,reason:bodyIssue.reason};
  return parse(n).diagnostic;
}
/** Unknown is intentionally distinct from inactive. Use this status alongside boolean filters. */
export function notamWindowStatus(n: SchedulableNotice, from: number, to: number): 'active' | 'inactive' | 'unknown' {
  if (n.cancelled || noticeHeader(n.text).kind === 'C') return 'inactive';
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 'unknown';
  if (scheduleDiagnostics(n).status === 'unsupported') return 'unknown';
  if (/\d{10}\s*EST\b/i.test(notamFields(n.text).C ?? '') && n.end !== null && to >= n.end) return 'unknown';
  const start = Math.max(from, n.start!), end = Math.min(to, n.permanent ? Infinity : n.end!);
  if (start > end || (n.end !== null && !n.permanent && start >= n.end)) return 'inactive';
  const parsed = parse(n);
  if (parsed.diagnostic.status === 'continuous') return 'active';
  if (end - start > 370 * DAY) return 'unknown';
  // Previous UTC day is necessary for overnight intervals.
  for (let day = Math.floor(start / DAY) * DAY - DAY; day <= end; day += DAY) {
    const date = new Date(day);
    for (const rule of parsed.rules) {
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
export const notamIsActive = (n: SchedulableNotice, now = Date.now()) => notamWindowStatus(n, now, now) === 'active';
export const notamOverlaps = (n: SchedulableNotice, start: number, end: number) => notamWindowStatus(n, start, end) === 'active';
/** Upcoming activation, including the next D interval of an already-in-force NOTAM; excludes currently active notices. */
export const notamStartsWithin = (n: SchedulableNotice, now: number, hours: number) => Number.isFinite(hours) && hours > 0 && notamWindowStatus(n, now, now) === 'inactive' && notamWindowStatus(n, now, now + hours * 3600000) === 'active';
/** Enumerate the validated D-field windows over a bounded published validity span. */
export function notamPeriods(n:SchedulableNotice):{start:number;end:number}[]{
 if(scheduleDiagnostics(n).status !== 'supported' || n.start===null || n.end===null || n.end-n.start>370*DAY)return [];
 const out:{start:number;end:number}[]=[]; const rules=parse(n).rules;
 for(let day=Math.floor(n.start/DAY)*DAY-DAY;day<n.end;day+=DAY){const date=new Date(day);for(const rule of rules){
  if(rule.month!==undefined&&date.getUTCMonth()!==rule.month)continue;
  if(rule.days&&!rule.days.includes(date.getUTCDate()))continue;
  if(rule.weekdays&&!rule.weekdays.includes(date.getUTCDay()))continue;
  for(const[a,b]of rule.times){const start=Math.max(day+a*60000,n.start),end=Math.min(day+b*60000,n.end);if(end>start)out.push({start,end});}
 }}
 return [...new Map(out.map(p=>[`${p.start}/${p.end}`,p])).values()].sort((a,b)=>a.start-b.start);
}

/** Explain the exact supported rule, not just its recognized time tokens. */
export function describeNotamSchedule(n: SchedulableNotice): {text: string; evidence: string; supported: boolean}[] {
  const diagnostic=scheduleDiagnostics(n);
  if(diagnostic.status==='unsupported') return [{text:`実施時間を確定できません。${diagnostic.reason || '原文の条件を確認してください。'}`,evidence:diagnostic.raw,supported:false}];
  if(diagnostic.status==='continuous') return [{text:'D欄による時間帯の限定はありません。B・C欄が示す有効期間内の通知です。施設の運用時間や個別の条件は本文の説明を確認してください。',evidence:'D欄の記載なし',supported:true}];
  const weekdays=['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
  const clockText=(minutes:number)=>`${Math.floor(minutes/60).toString().padStart(2,'0')}:${(minutes%60).toString().padStart(2,'0')}`;
  return parse(n).rules.map(rule=>{
    const selector=rule.weekdays?`毎週${rule.weekdays.map(day=>weekdays[day]).join('・')}`:rule.days?`${rule.month===undefined?'':`${rule.month+1}月`}${rule.days.map(day=>`${day}日`).join('・')}`:'毎日';
    const windows=rule.times.map(([start,end])=>start===0&&end===1440?'終日':`${clockText(start)}から${end>=1440?'翌日':''}${clockText(end%1440)}まで`).join('、');
    return {text:`${selector}の${windows}（UTC）。B・C欄の有効期間内に限ります。`,evidence:diagnostic.raw,supported:true};
  });
}
