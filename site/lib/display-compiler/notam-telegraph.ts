import { mainlandTelegraph, mainlandTelegraphSource } from './mainland-telegraph.generated';

export type TelegraphToken = {
  code: string; start: number; end: number;
  status: 'decoded' | 'unknown' | 'ambiguous'; candidates: readonly string[];
};
export type TelegraphEvidence = {
  rawBody: string; decodedBody: string; bodyStart: number; bodyEnd: number; trailingText: string;
  source: typeof mainlandTelegraphSource; tokens: TelegraphToken[];
  scope: 'bounded-mainland-e-groups';
};

/** A collision is evidence, never an invitation to choose a character. */
export function resolveTelegraphCode(candidates: readonly string[]) {
  return candidates.length === 1 ? 'decoded' : candidates.length ? 'ambiguous' : 'unknown';
}

/** Conservative recognition, not general numeric-to-Chinese substitution.
 * Require a mainland FIR and an E-field beginning with >=4 spaced codes, with
 * >=4 known mappings and a non-clock code. Later runs need >=2 codes and a
 * punctuation/start boundary. No isolated number, adjacent unit, header field,
 * coordinate component, slash date, clock schedule, or identifier is decoded.
 * Offsets are UTF-16 offsets into the unmodified original NOTAM.
 */
export function decodeMainlandTelegraph(text: string): TelegraphEvidence | null {
  const e = /(?:^|[\s(])E\)[ \t\r\n]*/i.exec(text);
  if (!e) return null;
  const head = text.slice(0, e.index);
  if (!/(?:^|\s)Q\)\s*(?:ZYSH|ZBPE|ZSHA|ZGZU|ZPKM|ZHWH|ZLHW|ZWUQ|ZJSA)\//i.test(head)) return null;
  const bodyStart = e.index + e[0].length;
  // Stop at any following field marker. Do not decode field labels or payloads,
  // even if malformed; multipart continuations are deliberately not decoded.
  const tail = text.slice(bodyStart);
  const stop = /(?:^|\s)[A-GQ]\)/i.exec(tail);
  const bodyEnd = bodyStart + (stop?.index ?? tail.length);
  const rawBody = text.slice(bodyStart, bodyEnd);
  const clock = (code: string) => +code.slice(0, 2) < 24 && +code.slice(2) < 60;
  const leading = /^(\d{4}(?:[ \t\r\n]+\d{4}){3,})(?=[ \t\r\n]*(?:(?:[;。；]|[,.，](?!\d))|$))/.exec(rawBody);
  if (!leading) return null;
  const codes = leading[1].split(/\s+/);
  if (codes.every(clock) || codes.filter(code => mainlandTelegraph[code]?.length === 1).length < 4) return null;
  const tokens: TelegraphToken[] = [];
  // A group is bounded by punctuation/start on the left and punctuation, end,
  // or an explicit value+unit on the right. This excludes PSN: numeric pairs.
  const run = /(^|(?:[;。；]|[,.，](?!\d))[ \t\r\n]*)(\d{4}(?:[ \t\r\n]+\d{4})+)(?=(?:[ \t\r\n]*(?:(?:[;。；]|[,.，](?!\d))|$)|[ \t\r\n]+\d+(?:\.\d+)?[ \t]*(?:KM|NM|M|FT)\b))/gi;
  let decodedBody = '', cursor = 0;
  for (const match of rawBody.matchAll(run)) {
    const start = match.index! + match[1].length;
    const group = match[2];
    if (group.split(/\s+/).every(clock)) continue;
    decodedBody += rawBody.slice(cursor, start);
    let groupCursor = 0;
    for (const token of group.matchAll(/\d{4}/g)) {
      const code = token[0], candidates = mainlandTelegraph[code] ?? [];
      const status = resolveTelegraphCode(candidates);
      const offset = token.index!;
      // Whitespace between decoded characters is encoding syntax. Preserve it
      // beside unresolved codes so the unresolved original remains legible.
      const separator = group.slice(groupCursor, offset);
      const previous = tokens.at(-1);
      decodedBody += status === 'decoded' && previous?.status === 'decoded' && groupCursor > 0 ? '' : separator;
      decodedBody += status === 'decoded' ? candidates[0] : code;
      tokens.push({code, start: bodyStart + start + offset, end: bodyStart + start + offset + 4, status, candidates});
      groupCursor = offset + 4;
    }
    cursor = start + group.length;
  }
  decodedBody += rawBody.slice(cursor);
  return {rawBody, decodedBody, bodyStart, bodyEnd, trailingText: text.slice(bodyEnd), source: mainlandTelegraphSource, tokens, scope:'bounded-mainland-e-groups'};
}

/** Deliberately narrow semantic template: one published PSN, optional 射高,
 * then 炮射半径. The leading place/activity phrase is explicitly reviewed,
 * not an unconstrained CJK capture that could conceal negation or cancellation.
 * It does not interpret arbitrary decoded Chinese prose. Any
 * extra/unknown text, multiple positions/radii, or qualifier fails closed.
 * Only the center and radius are fed to the existing coordinate parser.
 */
export function telegraphCircleGeometryText(evidence: TelegraphEvidence | null): string | null {
  if (!evidence || evidence.tokens.some(t => t.status !== 'decoded')) return null;
  // E continuations after F/G must not disappear from geometry reasoning.
  // Accept only the whole altitude-only suffix, never a prefix of it.
  if (evidence.trailingText.trim() && !/^\s*F\)\s*(?:GND|SFC)\s+G\)\s*(?:UNL|FL\s*\d{2,3}|\d+(?:\.\d+)?\s*(?:M|FT)(?:\s*(?:\(\s*(?:AGL|AMSL|MSL)\s*\)|AGL|AMSL|MSL))?)\s*\.?\s*\)?\s*$/i.test(evidence.trailingText)) return null;
  const body = evidence.decodedBody.trim();
  const match = /^(融安县人工炮射)\s*[,，]\s*PSN\s*:\s*([NS]\d{6}[EW]\d{7})\s*[.。]\s*(?:射高\s*\d+(?:\.\d+)?\s*(?:M|FT)\s*[,，]\s*)?炮射半径\s*(\d+(?:\.\d+)?)\s*(KM|NM|M|FT)\s*[.。]?$/i.exec(body);
  if (!match) return null;
  return `PSN: ${match[2]} RADIUS ${match[3]} ${match[4]}`;
}
