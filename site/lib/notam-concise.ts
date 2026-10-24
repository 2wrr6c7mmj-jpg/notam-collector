import type { ExplanationNotice, NoticeExplanation } from '@/lib/notam-explanation';
import { readableNotice } from '@/lib/notam-readable';
import { notamFields } from '@/lib/notam-schedule';
import { reviewedBodies } from './notam-concise-reviewed';

export type ConciseBody = {
  body: string;
  sourceAltitude: { F: string; G: string };
  title: string;
  summary: string[];
  conditions: string[];
  where?: string;
  altitude?: string;
  timing?: string;
  uncertainty?: string;
};
export const normalizeBody = (s: string) => s.replace(/\s+/g, ' ').trim();
const uniq = (s: string[]) => [...new Set(s.filter(Boolean))];
const shortenAltitude = (s: string) => s
  .replace(/フライトレベル (FL\d+)（標準気圧面による高度。対地高度・海抜高度とは異なります）/g, '$1（標準気圧）')
  .replace(/フィート/g, 'ft').replace(/メートル/g, 'm')
  .replace(/平均海面からの高度/g, '平均海面基準');
/** Exact E-body binding, never ID binding. Changed source fails closed to the general view.
 * These are concise summaries, not certifications of completeness or full translations.
 */
export function conciseNotice(n: ExplanationNotice, e: NoticeExplanation) {
  const full = readableNotice(n, e);
  const fields = notamFields(n.text);
  const body = normalizeBody(fields.E ?? '');
  const reviewed = reviewedBodies.find(entry => normalizeBody(entry.body) === body
    && normalizeBody(entry.sourceAltitude.F) === normalizeBody(fields.F ?? '')
    && normalizeBody(entry.sourceAltitude.G) === normalizeBody(fields.G ?? ''));
  const all = [...full.lead, ...Object.values(full.sections).flat()];
  const essential = all.filter(s => /閉鎖|使用不能|利用制限|許可|航空管制|除外|例外|飛行時間|通信連絡|注意を|適用/.test(s.explanation));
  // A known limitation is never hidden simply to satisfy a sentence budget.
  const genericConditions = uniq(essential.filter(s => !full.lead.includes(s)).map(s => s.display));
  return {
    full, reviewed: !!reviewed,
    title: reviewed?.title ?? full.title,
    summary: reviewed?.summary ?? (full.lead.length ? full.lead.map(s => s.display) : ['本文の意味をまだ確定できません。']),
    conditions: reviewed?.conditions ?? genericConditions,
    where: reviewed?.where ?? (full.sections.where.length ? full.sections.where[0].display + (full.sections.where.length>1 ? ` ほか${full.sections.where.length-1}件の場所・範囲は補足に記載。` : '') : undefined),
    altitude: reviewed?.altitude ?? (full.sections.altitude.length
      ? uniq(full.sections.altitude.map(s => shortenAltitude(s.display))).join(' / ')
      : full.altitude.map(a => `${a.label} ${shortenAltitude(a.value)}`).join(' / ') || '本文の適用高度を確認できません'),
    timing: reviewed?.timing ?? full.timing.filter(s=>!s.startsWith('D欄による時間帯の限定はありません。')).join(' / ').replace(/B・C欄の有効期間内に限ります。/g, '').trim(),
    // Reviewed summaries supersede parser diagnostics for this exact body only.
    // Unknown-source status occurs once; original residuals remain available below.
    uncertainty: reviewed?.uncertainty ?? (!reviewed && full.coverage !== 'explained'
      ? '未説明の条件があります。適用範囲・例外は原文も確認してください。' : undefined),
    warnings: reviewed ? [] : uniq(full.cautions),
    evidence: all,
  };
}
