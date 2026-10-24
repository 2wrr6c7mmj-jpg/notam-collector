/**
 * NOTAM fields with a structural E boundary.
 *
 * A)-E) tokens after the first E) belong to its free-text body, not to the header.
 * Only a consecutive, recognisable F)/G) altitude pair is split from the body.
 * Body continuations after a pair (including multipart transmissions and RMK)
 * are appended to E, so no substantive body text disappears into G.
 * Unrecognisable or unpaired F)/G) tokens remain verbatim in E.
 *
 * This is extraction, not altitude interpretation: a missing datum stays missing.
 */
export function notamFields(text: string): Record<string, string> {
  if (/^\s*\(/.test(text) && /\)\s*$/.test(text)) text = text.replace(/\)\s*$/, '');
  const fields: Record<string, string> = {};
  const add = (key: string, raw: string) => {
    const value = raw.trim();
    // Do not hide duplicate structural fields, including empty duplicates.
    fields[key] = Object.hasOwn(fields, key) ? `${fields[key]}\n[DUPLICATE ${key}] ${value}` : value;
  };
  const firstE = /(?:^|\s)E\)\s*/i.exec(text);
  const headerEnd = firstE?.index ?? text.length;
  const head = text.slice(0, headerEnd);
  const header = [...head.matchAll(/(?:^|\s)([QABCD])\)\s*/gi)];
  header.forEach((m, i) => add(m[1].toUpperCase(), head.slice(m.index! + m[0].length, header[i + 1]?.index ?? head.length)));
  if (!firstE) return fields;
  const body = text.slice(firstE.index + firstE[0].length);
  // Require units for numeric altitudes. In particular, do not split F)/G)
  // latitude-longitude bullets, runway/taxiway names, or ordinary parentheses.
  const number = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
  const altitude = String.raw`(?:SFC|GND|SURFACE|UNL|UNLIMITED|FL\s*\d{2,3}|${number}\s*(?:FT|M)(?:\s*(?:\(\s*(?:AGL|AMSL|MSL)\s*\)|(?:AGL|AMSL|MSL)))?)`;
  const pair = new RegExp(String.raw`(?:^|\s)F\)\s*(${altitude})\s+G\)\s*(${altitude})(?![A-Z0-9])`, 'gi');
  const parts: string[] = [];
  let end = 0;
  for (const m of body.matchAll(pair)) {
    parts.push(body.slice(end, m.index));
    add('F', m[1]); add('G', m[2]);
    end = m.index! + m[0].length;
  }
  parts.push(body.slice(end));
  // Only extraction boundaries are normalised; text within each fragment is exact.
  fields.E = parts.map(part => part.trim()).filter(Boolean).join('\n');
  return fields;
}
