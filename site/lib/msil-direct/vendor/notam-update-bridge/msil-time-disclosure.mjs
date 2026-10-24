// Describe missing source information separately from parser limitations.
// These labels never change activity or cancellation status.
export function timeDisclosure(item,result){
 const reasons=result.reasons,body=item.text.normalize('NFKC').split('\n').filter(l=>!l.includes('発表')&&!/航行警報.*(?:番号|:)/.test(l)).join('\n');
 if(result.cancellation.state==='cancelled')return {kind:'cancelled',label:'取消済み',detail:'原文でこの警報自身の取消を確認しています。'};
 if(result.openEndedPeriods.length)return {kind:'source-open-end',label:'原文は終了未定・開始日時あり',detail:'開始日時は読み取れますが、原文の終了は追って通知です。'};
 if(reasons.includes('area-specific-period-mapping-unresolved'))return {kind:'parser-area',label:'期間記載あり・区域別時刻は未対応',detail:'原文には日時がありますが、区域ごとの時刻と図形の対応を確定できていません。'};
 if(reasons.includes('conflicting-explicit-time-zones'))return {kind:'parser-zone-conflict',label:'本文の時区指定が競合',detail:'本文の時区指定が一致しないため、配信元の標準時区で上書きせず競合箇所を残しています。'};
 if(reasons.includes('unsupported-explicit-time-zone'))return {kind:'parser-zone-conflict',label:'本文の現地時区を確認',detail:'本文に現地時刻や複数の意味を持つ時区略号があります。配信元の標準時区とは区別して扱います。'};
 if(reasons.includes('time-zone-not-established'))return {kind:'parser-zone',label:'期間記載あり・時区未確認',detail:'原文の日付・時刻は確認できますが、JST/UTC等の根拠が不足しています。期間未定という意味ではありません。'};
 if(reasons.includes('holiday-calendar-unresolved'))return {kind:'parser-calendar',label:'期間記載あり・祝日除外は未対応',detail:'原文の日時には祝日除外条件があり、適用する休日を確定できていません。'};
 if(/当分の間|追って|UNTIL\s+FURTHER\s+NOTICE/i.test(body))return {kind:'source-open-end',label:'原文は終了未定・開始日時は要確認',detail:'原文は終了を追って通知としています。掲載日時を活動開始に置き換えていません。'};
 if(reasons.includes('start-not-established'))return {kind:'source-end-only',label:'原文は終了のみ・開始記載なし',detail:'終了の記載はありますが、活動開始日時は読み取れません。掲載日時から補っていません。'};
 if(reasons.includes('no-bounded-activity-period')||reasons.includes('observation-or-issue-time-only')||reasons.includes('year-not-established')&&!/\d{1,2}月[^\n]*\d{1,2}日[^\n]*(?:[-〜～]|まで)/.test(body))return {kind:'source-no-bounds',label:'原文に活動の始終記載なし',detail:'灯火・障害物の状態や観測情報など、活動開始と終了の両端が記載されていません。観測・発表日時を活動期間としていません。'};
 if(result.dateOnlyFallback&&result.periods.length)return {kind:'source-date-only',label:'期間',detail:'原文の日付範囲を日付単位の期間として扱います。日中の実施時刻は指定されていません。'};
 if(result.completeness==='complete')return {kind:'parsed',label:'実施時間を確認済み',detail:'原文の日時と根拠に基づく判定です。'};
 return {kind:'parser-other',label:result.periods.length?'一部の日時は要確認':'期間の解析は要確認',detail:'予備日や追加制限などの未解決条件があります。未解析を期間未定とは扱っていません。'};
}
