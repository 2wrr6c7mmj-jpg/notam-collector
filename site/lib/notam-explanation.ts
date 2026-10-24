import {interpretAviationBody, type SemanticInterpretation} from "./notam-semantic-blocks";
import { notamFields, noticeHeader, scheduleDiagnostics, describeNotamSchedule } from './notam-schedule';
export type ExplanationNotice = { text: string; id?: string; location?: string; start: number | null; end: number | null; permanent?: boolean; cancelled?: boolean; issued?: number | null; purpose?: string; sourceName?: string; sourceUrl?: string };
export type NoticeExplanation = { aviation?: SemanticInterpretation; summary: string; facts: { label: string; value: string; evidence?: string }[]; unresolved: string[]; clauses: { original: string; explanation?: string; status: 'explained' | 'unresolved' }[] };
function time(value: number | null) { return value !== null && Number.isFinite(value) ? new Date(value).toISOString().replace('T', ' ').replace(':00.000Z', ' UTC') : '判定できません'; }
export function explainAltitude(raw: string): string | null {
  const t = raw.toUpperCase().replace(/(?<=\d),(?=\d{3}\b)/g,'').replace(/\((AGL|AMSL|MSL)\)/g,' $1').replace(/\s+/g, ' ').trim();
  if (/^(SFC|GND|SURFACE)$/.test(t)) return '地表・水面';
  if (/^(UNL|UNLIMITED)$/.test(t)) return '上限なし';
  const fl = t.match(/^FL\s*(\d{2,3})$/);
  if (fl) return `フライトレベル FL${fl[1]}（標準気圧面による高度。対地高度・海抜高度とは異なります）`;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(FT|M)\s*(AGL|AMSL|MSL)$/);
  if (m) return `${m[1]}${m[2] === 'FT' ? 'フィート' : 'メートル'}（${m[3] === 'AGL' ? '対地高度' : '平均海面からの高度'}）`;
  return null;
}
const terms: [RegExp, string][] = [
  [/\b(?:FIRING|FRNG|GUNNERY)\b/, '射撃'], [/\bMISSILE\b/, 'ミサイル'], [/\bROCKET\b/, 'ロケット'],
  [/\b(?:UNMANNED|UAS|UAV|RPAS|DRONE)\b/, '無人航空機'], [/\b(?:TRAINING|TRG|EXERCISE|EXER)\b/, '訓練・演習'],
  [/\b(?:CLSD|CLOSED)\b/, '閉鎖'], [/\b(?:U\/S|UNSERVICEABLE)\b/, '使用不能'], [/\bOBST\b/, '障害物'],
  [/\b(?:EXC|EXCL|EXCEPT|EXCLUDING|EXCLUDED)\b/, '除外・例外条件'], [/\b(?:PERMISSION|APPROVAL|PPR|PRIOR)\b/, '許可・事前手続き条件'],
  [/\b(?:PROHIBITED|PROHIBITION)\b/, '禁止'], [/\b(?:RESTRICTED|RESTRICTION|RESTRICTIONS)\b/, '制限'],
  [/\bCOUNTERCLOCKWISE\b|\bANTI-CLOCKWISE\b/, '反時計回り'], [/\bCLOCKWISE\b/, '時計回り'],
];
const fieldLabels: Record<string,string> = { Q:'Q欄（選別情報）', A:'対象地点・FIR（A欄）', B:'有効開始（B欄）', C:'有効終了（C欄）', D:'実施時間帯（D欄）', E:'内容（E欄）', F:'下限高度（F欄）', G:'上限高度（G欄）' };
export function explainNotice(n: ExplanationNotice, maritime = false): NoticeExplanation {
  const fields = maritime ? {} : notamFields(n.text);
  const header = noticeHeader(n.text);
  const facts: NoticeExplanation['facts'] = [], unresolved: string[] = [];
  const add = (label:string,value:string,evidence?:string) => facts.push({label,value,evidence});
  if (maritime) {
    add('情報種別','航行警告（航空NOTAMのQ/A/B/C/D/E/F/G欄としては解釈しません）');
    add('読み取れた開始',time(n.start)); add('読み取れた終了',n.permanent ? '期限指定なし' : time(n.end));
    if (n.location) add('対象海域',n.location,n.location);
    if (n.sourceName || n.sourceUrl) add('発表元・出典',[n.sourceName,n.sourceUrl].filter(Boolean).join(' / '));
    const cancel = n.text.match(/(?:撤销|取消|撤銷)\s*([^。；，]*航警\s*\d+\/\d+)/);
    if (cancel) add('取消','次の航行警告を取り消す：'+cancel[1],cancel[0]);
    const maritimeTerms: [RegExp,string,string][] = [
      [/\b(?:GUNNERY|LIVE[ -]?FIRING|LIVE[ -]?FIRE)\b/i,'活動','射撃・実弾射撃'],
      [/\b(?:ROCKET|MISSILE|SPACE DEBRIS|LAUNCH)\b/i,'活動','ロケット・ミサイル・打ち上げ・落下物に関する記載'],
      [/\b(?:MILITARY|NAVAL EXERCISE)\b/i,'活動','軍事活動・海上演習'],
      [/\b(?:AVOID|GIVE A WIDE BERTH|CAUTION)\b/i,'航行上の要請','避航または注意を求める記載。対象区域と条件は原文を確認'],
      [/军事(?:活动|演习|训练)|軍事(?:活動|演習|訓練)/,'活動','軍事活動・訓練'],
      [/实弹射击|實彈射擊|射击训练|射擊訓練/,'活動','実弾射撃・射撃訓練'],
      [/火箭(?:发射|發射)|发射火箭|發射火箭/,'活動','ロケット発射'],
      [/拖带|拖帶|拖航/,'活動','船舶・構造物の曳航'],
      [/施工作业|施工作業|工程施工/,'活動','海上工事・施工作業'],
      [/打捞|打撈/,'活動','引揚げ・サルベージ作業'],
      [/地质勘查|地質勘查|地震采集|地震採集|测量作业|測量作業/,'活動','地質・地震探査または測量作業'],
      [/加注作业|加注作業/,'活動','燃料等の補給作業'],
      [/吊装作业|吊裝作業/,'活動','吊上げ・揚重作業'],
      [/临时撤除|臨時撤除/,'航路標識等','一時撤去の記載あり。撤去対象を原文で確認'],
      [/临时交通管制|臨時交通管制/,'交通規制','一時的な交通管制'],
      [/无关船舶禁止驶入|無關船舶禁止駛入/,'禁止','無関係の船舶は進入禁止'],
      [/禁止所有船舶[^。；]*/,'禁止','全船舶に対する禁止事項あり。対象行為・区域は引用原文を確認'],
      [/禁止驶入|禁止駛入|禁止进入|禁止進入/,'禁止','進入禁止の記載あり。対象船舶・区域は引用原文を確認'],
      [/请(?:各航船)?避让|請(?:各航船)?避讓|请宽让|請寬讓/,'航行上の要請','十分な距離を取り、避航するよう要請'],
      [/(?:希|请|請)(?:各航船|各船舶)注意/,'航行上の要請','航行船舶への注意喚起'],
      [/听从当地海事管理机构现场指挥|聽從當地海事管理機構現場指揮/,'航行上の要請','現地海事当局の指示に従うよう要請'],
    ];
    for (const [rx,label,value] of maritimeTerms) { const hit=n.text.match(rx); if(hit) add(label,value,hit[0]); }
    const timeClauses=n.text.match(/(?:自|从|從)?(?:\d{1,2}月)?\d{1,2}日[^，。；]{0,100}?(?:时|時)(?:至[^，。；]{0,40}?(?:时|時))?/g);
    for(const clause of timeClauses??[]) add('原文の日時条件',clause+'（原文の日時条件。時区と読取り済みの期間は上記・出典を確認）',clause);
    if(/每日|每天/.test(n.text)) unresolved.push('毎日の時間帯指定があります。開始・終了日時だけでは個別の実施時間を表しません。');
    const numeric: [RegExp,string,string][] = [[/拖带(?:总长(?:度)?|长度)|拖帶(?:總長(?:度)?|長度)/,'曳航規模',''],[/航速/,'航行速度','']];
    for(const [rx,label] of numeric) { const hit=n.text.match(new RegExp('(?:'+rx.source+')\\s*([0-9.]+)\\s*(米|节|節)')); if(hit) add(label,hit[1]+(hit[2]==='米'?'メートル':'ノット'),hit[0]); }
    const boundary=n.text.match(/(?:[一二三四五六七八九十\d]+点)?连线(?:所围)?水域|(?:[一二三四五六七八九十\d]+點)?連線(?:所圍)?水域/);
    if(boundary) add('区域の指定','原文に列挙された点を結ぶ水域。地図の境界と座標原文を照合してください。',boundary[0]);
    const path=n.text.match(/航经[^。；]+|航經[^。；]+/); if(path) add('通航経路', '経由地・航路の指定があります。固有名は原文を保持：'+path[0],path[0]);

  } else {
    const status = n.cancelled ? 'データ提供元で取消済み' : header.kind === 'C' ? `取消通知${header.reference ? `：${header.reference}を取り消す` : '（対象番号を確認してください）'}` : header.kind === 'R' ? `置換通知${header.reference ? `：${header.reference}をこの通知で置き換える` : '（対象番号を確認してください）'}` : header.kind === 'N' ? '新規通知' : '通知種別を確定できません';
    add('通知種別',status,header.raw);
    if (header.kind === 'R' || header.kind === 'C') unresolved.push('参照先・後続NOTAMの取得状況から、最新の取消・置換関係を確認してください。');
    for (const key of ['Q','A','B','C','D','F','G']) {
      const raw = fields[key];
      if (!raw) continue;
      let value = raw;
      if (key === 'B') value = `${time(n.start)}（B欄は有効開始。通常、発出時刻とは異なります）`;
      if (key === 'C') value = /\bPERM\b/.test(raw) ? '恒久的な情報（PERM）' : `${time(n.end)}${/\d{10}\s*EST\b/i.test(raw) ? '（EST：終了予定。取消・置換確認が必要）' : ''}`;
      if (key === 'D') { const d = scheduleDiagnostics(n); value = describeNotamSchedule(n).map(rule=>rule.text).join('\n'); if (d.reason) unresolved.push(`D欄：${d.reason}`); }
      if (key === 'F' || key === 'G') { value = explainAltitude(raw) ?? `${raw}（高度の基準・単位を確定できません）`; if (!explainAltitude(raw)) unresolved.push(`${key}欄の高度を原文で確認：${raw}`); }
      if (key === 'Q') {
        const q = raw.split('/');
        if (q.length === 8 && /^Q[A-Z]{4}$/.test(q[1]) && /^\d{3}$/.test(q[5]) && /^\d{3}$/.test(q[6])) {
          value = `FIR ${q[0]} / Qコード ${q[1]} / 交通 ${q[2]} / 目的 ${q[3]} / 範囲 ${q[4]} / 選別用高度 ${q[5]}–${q[6]} / 位置・半径 ${q[7]}。Q欄の高度・円は検索用の概略で、実際の制限はE/F/G欄を確認。`;
        } else { value = `${raw}（Q欄全体の形式を確定できません）`; unresolved.push('Q欄の未解釈部分があります。'); }
      }
      add(fieldLabels[key],value,raw);
      if (/\[DUPLICATE/.test(raw)) unresolved.push(`${key}欄が重複しており、全体の構造確認が必要です。`);
    }
    if (fields.Q) {
      const q=fields.Q.split('/');
      const subjects:Record<string,string>={RD:'危険区域',RP:'飛行禁止区域',RR:'制限区域',RT:'一時飛行制限',RA:'空域留保',WM:'ミサイル・砲射撃・ロケット発射',WL:'自由気球の上昇',WV:'編隊飛行',WU:'無人航空機',WE:'演習',OL:'障害物灯',MR:'滑走路',MX:'誘導路',FA:'飛行場',NM:'VOR/DME',NV:'VOR'};
      const states:Record<string,string>={CA:'活動開始・有効化',CD:'活動停止・無効化',AS:'使用不能',AO:'運用中',AH:'運用時間の変更',LC:'閉鎖',LW:'実施予定',XX:'状態は本文で確認'};
      const state=q[1]?.slice(3,5); if(state) add('Qコードの状態',states[state] || `${state}（この状態コードは未対応。E欄を確認）`,q[1]);
      const subject=q[1]?.slice(1,3); if(subject&&subjects[subject]) add('Qコードの対象',subjects[subject],q[1]);
      const decode=(raw:string|undefined,map:Record<string,string>)=>raw?[...raw].map(c=>map[c]??`未解釈コード ${c}`).join('、'):'不明';
      add('Q欄：対象交通',decode(q[2],{I:'IFR（計器飛行方式）',V:'VFR（有視界飛行方式）',K:'チェックリスト'}),q[2]);
      add('Q欄：情報選別目的',decode(q[3],{N:'運航乗務員への即時注意',B:'飛行前情報ブリーフィング向け',O:'運航上重要',M:'その他',K:'チェックリスト'}),q[3]);
      add('Q欄：適用範囲',decode(q[4],{A:'飛行場',E:'航空路',W:'航行警報',K:'チェックリスト'}),q[4]);
    }
    const e=fields.E??'';
    for(const [rx,label] of terms) { const hit=e.match(new RegExp(rx.source,'i')); if(hit) add('E欄の用語',label+'（用語の認識。適用条件・否定・範囲を確定するものではありません）',hit[0]); }
    for(const clause of e.split(/\r?\n|(?<=[.;])\s+/)) if(/\b(?:EXC|EXCL|EXCEPT|EXCLUDING|UNLESS|SUBJECT TO|PRIOR|PERMISSION|APPROVAL|PPR)\b/i.test(clause)) add('例外・許可等の条件（原文）',clause,clause);
    if (!fields.B) unresolved.push('B欄が見つかりません。');
    if (!fields.C && header.kind !== 'C') unresolved.push('C欄が見つかりません。');
    if (!fields.D) { const d=describeNotamSchedule(n); add('実施時間帯（D欄）',d.map(rule=>rule.text).join('\n')); if(d.some(rule=>!rule.supported)) unresolved.push(d.map(rule=>rule.text).join('\n')); }
  }
  const multipart = !maritime && /\b(?:END\s+PART|PART\s+\d+\s+OF\s+\d+)\b|\[DUPLICATE/.test(n.text+' '+Object.values(fields).join(' '));
  const firstE = n.text.match(/(?:^|\s)E\)\s*/);
  // Multipart transmissions may resume E-content after repeated F/G without another E marker.
  // Keep every byte after first E as an unresolved clause instead of silently dropping continuations.
  const body = maritime ? n.text : multipart && firstE ? n.text.slice(firstE.index!+firstE[0].length) : fields.E ?? n.text;
  if (multipart) unresolved.push('複数パートまたは欄の重複を検出しました。最初のE欄以降の全文を保持しています。F/G欄以降の継続本文と欄の適用範囲は未確定です。');
  const aviation=maritime ? undefined : interpretAviationBody(fields.E ?? body);
  if(aviation && multipart) {
    aviation.status='partial';
    aviation.warnings.push('複数パートや高度欄の重複があります。本文の説明だけでは、各区域とF/G欄の対応や未受信パートの有無を確定できません。');
    for(const block of aviation.blocks) if(block.status==='explained') block.status='partial';
  }
  const clauses: NoticeExplanation['clauses'] = body.split(/\r?\n|(?<=[.!;])\s+(?=[A-Z])|(?<=[。；])/).map(s=>s.trim()).filter(Boolean).map(original => {
    const upper = original.toUpperCase();
    // Only whole-clause templates may be marked explained. Keyword recognition never claims semantic coverage.
    const closure = upper.match(/^(RWY\s+\d{2}[LRC]?(?:\/\d{2}[LRC]?)?|TWY\s+[A-Z0-9-]+|AD)\s+(?:IS\s+)?(?:CLSD|CLOSED)\.?$/);
    if (closure) return { original, explanation: `${closure[1].replace(/^RWY/, '滑走路').replace(/^TWY/, '誘導路').replace(/^AD$/, '飛行場')}は閉鎖されています。`, status: 'explained' as const };
    if (/^OBST LGT U\/S\.?$/.test(upper)) return { original, explanation:'障害物灯が使用不能です。', status:'explained' as const };
    const recognized = terms.filter(([rx])=>rx.test(upper)).map(([,label])=>label);
    return { original, explanation:recognized.length ? `含まれる用語：${recognized.join('、')}。文全体の条件・係り受けは未解釈です。` : undefined, status:'unresolved' as const };
  });
  const semanticClauses=aviation?.blocks.flatMap(block=>[...block.evidence.map(e=>({original:e.original,explanation:e.explanation,status:'explained' as const})),...block.residuals.map(r=>({original:r.original,explanation:r.reason,status:'unresolved' as const}))]);
  if(aviation?.blocks.some(block=>block.evidence.length) && semanticClauses?.length) clauses.splice(0,clauses.length,...semanticClauses);
  if(aviation) unresolved.push(...aviation.warnings);
  const unknown = clauses.filter(c=>c.status==='unresolved');
  // Every unsupported clause is retained explicitly, not replaced by a single generic caveat.
  for (const clause of unknown) unresolved.push(`未解釈：${clause.original}`);
  if (!maritime && !fields.E) unresolved.push('E欄が見つからず、原文全体を確認対象としています。');
  const labels=[...new Set(facts.filter(f=>f.label === "活動" || f.label === "Qコードの対象").map(f=>f.value))];
  const subject=labels.length ? labels.map(label=>label.replace(/に関する記載$/, "")).join("、") : maritime ? "航行上の注意事項" : "航空情報の変更";
  const cancellation=n.cancelled || header.kind === 'C';
  const core=aviation?.status==='partial' ? `${aviation.blocks[0].title}についての通知です。対象・範囲・条件に、まだ説明を確定できない部分があります。` : aviation?.blocks.flatMap(block=>block.evidence).find(e=>e.explanation)?.explanation;
  const summary=cancellation ? `取消し・終了が確認されている通知です。対象番号と原文を確認してください。` : `${core || `本文の主な内容：${subject}。`}${header.kind === "R"?"以前のNOTAMを置き換えています。":""}${unknown.length?`原文の確認が必要な部分が${unknown.length}件あります。`:""}`;
  return { aviation, summary, facts, unresolved:[...new Set(unresolved)], clauses };
}
