import type { ExplanationNotice, NoticeExplanation } from '@/lib/display-compiler/notam-explanation';
import type { SemanticEvidence } from '@/lib/display-compiler/notam-semantic-blocks';

type Section = 'where' | 'altitude' | 'conditions' | 'other';
export type ReadableStatement = SemanticEvidence & { key: string; display: string };
export type ReadableNotice = {
  title: string;
  lead: ReadableStatement[];
  sections: Record<Section, ReadableStatement[]>;
  period: string;
  timing: string[];
  altitude: { label: string; value: string }[];
  cautions: string[];
  unresolved: { key: string; original: string; reason: string }[];
  coverage: 'explained' | 'partial' | 'unresolved';
  status: string | null;
};
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const date = (value: number | null) => value !== null && Number.isFinite(value)
  ? new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '日時を読み取れません';

/** Display-only compression of coordinate lists emitted by the trusted semantic parser.
 * It does not parse a new source clause, infer a place, or claim map accuracy.
 * Exact explanation and evidence are retained for the disclosure below.
 */
export function compactStatement(value: string): string {
  const coordinate = String.raw`\d{6}(?:\.\d+)?[NS]\s*\d{7}(?:\.\d+)?[EW]`;
  return value.replace(new RegExp(`(?:${coordinate})(?:\\s*→\\s*(?:${coordinate})){2,}`, 'g'), '原文の座標一覧（下の「日本語と原文の対応」で確認）');
}
function sectionOf(e: SemanticEvidence): Section {
  // Categorization only. Nothing is translated, approved, or discarded here.
  if (/航空管制|許可|閉鎖|使用不能|利用制限|除外|例外|連絡を維持|注意を|適用|飛行時間/.test(e.explanation)) return 'conditions';
  if (/位置：/.test(e.explanation)) return 'where';
  if (/高度範囲|最高高度|標高/.test(e.explanation)) return 'altitude';
  if (/境界|円内|全幅|場所の名称|運航位置|次の座標|区域は次の区域|この区域は.+に含まれ/.test(e.explanation)) return 'where';
  return 'other';
}
export function readableNotice(n: ExplanationNotice, e: NoticeExplanation): ReadableNotice {
  const semantic = e.aviation;
  const evidence = semantic?.blocks.flatMap((b, bi) => b.evidence.map((s, si) => ({ ...s, key: `${bi}-${si}`, display: compactStatement(s.explanation) }))) ?? [];
  const lead = evidence.length ? [evidence[0]] : [];
  const sections: ReadableNotice['sections'] = { where: [], altitude: [], conditions: [], other: [] };
  for (const statement of evidence.slice(1)) sections[sectionOf(statement)].push(statement);
  const residuals = semantic?.blocks.flatMap((b, bi) => b.residuals.map((r, ri) => ({ ...r, key: `${bi}-${ri}` }))) ?? [];
  // The engine includes warnings and exact untranslated tails in unresolved. Show warnings
  // once; do not copy long untranslated text into a second competing diagnostic list.
  const semanticResidualText = new Set(residuals.map(r => `未解釈：${r.original}`));
  const cautions = unique([...(semantic?.warnings ?? []), ...e.unresolved.filter(s => !semanticResidualText.has(s) && !s.startsWith('未解釈：'))]);
  const fallbackResiduals = e.unresolved.filter(s => s.startsWith('未解釈：') && !semanticResidualText.has(s) && !residuals.some(r => r.original.includes(s.slice(4)))).map((s, i) => ({key:`extra-${i}`,original:s.slice(4),reason:'この部分の意味はまだ説明できません。'}));
  const timing = e.facts.filter(f => f.label === '実施時間帯（D欄）').map(f => f.value);
  const altitude = e.facts.filter(f => /^(下限高度|上限高度)/.test(f.label)).map(f => ({label:f.label.startsWith('下限')?'下限':'上限',value:f.value}));
  const statusFact = e.facts.find(f => f.label === '通知種別');
  const status = statusFact && /取消|置換/.test(statusFact.value) ? statusFact.value : null;
  const endFact = e.facts.find(f => f.label === '有効終了（C欄）');
  const estimated = endFact?.value.includes('終了予定');
  const coverage = semantic?.status ?? 'unresolved';
  return {
    title: semantic?.family === 'unsupported' ? '本文の日本語説明は未対応です' : semantic?.blocks[0]?.title ?? '本文の日本語説明は未対応です',
    lead, sections,
    period: `${date(n.start)} 〜 ${n.permanent ? '恒久（PERM）' : date(n.end)}${estimated ? '（終了予定・EST）' : ''}`,
    timing: unique(timing), altitude, cautions, unresolved: [...residuals, ...fallbackResiduals], coverage, status,
  };
}
