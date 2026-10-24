// Topic recognition only: this never establishes activity dates, cancellation,
// geometry or current validity. Keep blasting/disposal and Q-code inference out.
// JCG headings use 「爆撃、」 / “BOMBING.”; explicit exercise wording is also
// accepted. A reference to a bombing range is not itself a bombing activity.
export function bombingActivityEvidence(text = '') {
  if (typeof text !== 'string') return [];
  const normalized = text.replace(/\r\n?/g, '\n');
  if (/(?:爆撃|射爆撃)[^。；;]{0,48}(?:中止|取消|実施(?:しません|しない|されません|されない)|行われません|行われない)|\bNO\s+(?:AERIAL\s+)?BOMBING\b|\bBOMBING\b[^.;]{0,48}\b(?:CANCELLED|CANCELED|WILL\s+NOT|NOT\s+TAKING\s+PLACE)\b/i.test(normalized)) return [];
  const clauses = normalized.split(/\n|[。；;]|(?<=\.)[ \t]+|[、，]/).map(s => s.trim());
  return clauses.filter(clause =>
    /^(?:射)?爆撃(?:訓練|演習)?(?=[、。，,\s\d]|$)/.test(clause)
    || /(?:射)?爆撃(?:訓練|演習)?\s*(?:が\s*(?:実施され|行われ)|を\s*実施)/.test(clause)
    || /^(?:(?:AERIAL|LIVE)[ -]+)?BOMBING(?=\s*(?:[.,:]|$|\d|(?:PRACTICE|EXERCISES?|TRAINING|ACTIVIT(?:Y|IES)|OPERATIONS?|WILL\s+TAKE\s+PLACE|IN\s+PROGRESS)\b))/i.test(clause));
}

export function hasBombingActivity(text) {
  return bombingActivityEvidence(text).length > 0;
}

// Preserve the existing category for every non-bombing source record.
export function maritimeActivityPurpose(text, existingPurpose = 'other') {
  return hasBombingActivity(text) ? 'firing' : existingPurpose;
}
