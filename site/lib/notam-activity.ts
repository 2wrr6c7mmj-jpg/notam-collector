import { extractNoticeBody, type Notice } from './notam';

/** Activity selection is independent of the closure/hazard drawing category. */
export function isPriorityActivity(notice: Pick<Notice, 'text'>): boolean {
  const body = extractNoticeBody(notice.text).toUpperCase();
  return /\b(?:MIL|MILITARY)\s+(?:ACT(?:IVITY|IVITIES)?|EXER(?:CISE|CISES)?|OPS?|OPERATIONS?|TRAINING|TRG|ACFT|AIRCRAFT)\b|\b(?:AIR|NAVAL)\s+EXER(?:CISE|CISES)?\b|\b(?:EXERCISES?|FIRING|FRNG|MISSILES?|ROCKETS?|LAUNCH(?:ES|ING)?|GUNNERY|BOMBING)\b/.test(body)
    || /Q\)\s*[A-Z]{4}\/Q(?:WM|WE)[A-Z]{2}\//i.test(notice.text);
}
