/**
 * Syntax-only normalization, with no date/month/year or time-zone inference.
 * Leaves explicit date-time spans (e.g. 01 0000-03 1200) untouched, so callers
 * that cannot model them must keep them unsupported.
 */
export function normalizeNotamScheduleSyntax(raw: string): string {
  let text = raw.toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  text = text.replace(/\bDLY\b/g, 'DAILY')
    .replace(/\(NEXT DAY\)/g, '')
    .replace(/\bUTC\b/g, '')
    .replace(/(\d{4})\/(\d{4})/g, '$1-$2')
    .replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  // AND joins complete clock pairs, never date selectors or partial spans.
  text = text.replace(/(\b\d{4}-\d{4})\s+AND\s+(?=\d{4}-\d{4}\b)/g, '$1 ');
  if (/\bDAILY$/.test(text)) text = 'DAILY ' + text.replace(/\s+DAILY$/, '');
  const every = text.match(/^((?:H24|\d{4}-\d{4})(?:\s+(?:H24|\d{4}-\d{4}))*)\s+EVERY\s+((?:SUN|MON|TUE|WED|THU|FRI|SAT)(?:[ -]+(?:SUN|MON|TUE|WED|THU|FRI|SAT))*)$/);
  if (every) text = `${every[2]} ${every[1]}`;
  // The boundary is proved by a completed clock pair followed by a two-digit
  // day selector (optionally a spelled month). A second HHMM-HHMM stays in the
  // same group. Day ranges and date-time spans are not rewritten internally.
  return text.replace(/(\b(?:\d{4}-\d{4}|H24))\s+(?=(?:(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?\d{2}(?!\d)(?:\s|-(?:\d{2}(?!\d)|(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b)))/g, '$1, ');
}
