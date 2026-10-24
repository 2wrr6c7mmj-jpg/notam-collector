// Reusable decisions for the JCG/MSIL warning services. These are source rules,
// not an assumption that Japanese language, issuer country or coordinates set TZ.
const REGIONAL_URL='https://www1.kaiho.mlit.go.jp/KAN5/tuho/keiho.html';
const MSI_URL='https://iho.int/uploads/user/pubs/standards/s-53/S_53_JAN16_E.pdf';
const NAVTEX_URL='https://www1.kaiho.mlit.go.jp/TUHO/keiho/navtex.html';
const JAPAN_URL='https://www1.kaiho.mlit.go.jp/TUHO/keiho/japan_nw.html';
const distinguishClockRange=s=>s.replace(/(\d{4}\s*)(UTC|GMT)(\s*-\s*)(\d{4}\s*)(UTC|GMT)\b/gi,'$1($2)$3$4($5)');
const normalize=s=>String(s||'').normalize('NFKC').replace(/[−―‐–—－]/g,'-');
export const warningBody=item=>normalize(item.text).split('\n').filter(l=>!l.includes('発表日時')&&!/^NO\.[\d-]+\s+Date:/.test(l)&&!/^\s*(?:NAVAREA|NAVTEX|日本)航行警報[:：]/.test(l)&&!(/地域航行警報/.test(l)&&/番号/.test(l))&&!l.includes('[利用上の制限事項]')).join('\n');
const zoneLabels=/(?<![A-Z])(?:UTC|GMT)(?:\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?)?(?![A-Z])|(?<![A-Z])(?:JST|KST)(?![A-Z])|協定世界時|世界標準時|世界時|日本標準時|韓国標準時|韓國標準時|韩国标准时|日本(?:時間|時刻)|東京(?:時間|時刻)|北京(?:時間|时间|時刻)|中国標準時|中國標準時|中国标准时|台湾(?:時間|時刻)|台灣(?:時間|時刻)|臺灣(?:時間|時刻)|香港(?:時間|時刻)|韓国時間|韓國時間|韩国时间/gi;
const unsupportedLabels=/(?<![A-Z])(?:CST|IST|PST|PDT|EST|EDT|CET|CEST|MSK|LOCAL\s+TIME)(?![A-Z])|現地時(?:間|刻)?|当地時(?:間|刻)?|當地時(?:間|刻)?/gi;
export function stripTimeZoneLabels(text){return text.replace(zoneLabels,'');}
export function timeZoneOffsetMinutes(zone){
 if(zone==='UTC')return 0;if(zone==='JST'||zone==='KST')return 540;
 const m=String(zone).match(/^UTC([+-])(\d{2}):(\d{2})$/);if(!m||+m[2]>14||+m[3]>59||(+m[2]===14&&+m[3]))return null;
 return (m[1]==='-'?-1:1)*(+m[2]*60+ +m[3]);
}
function zoneForLabel(m){
 if(/^(?:UTC|GMT)/i.test(m[0])){
  if(!m[1])return 'UTC';if(+m[2]>14||+(m[3]||0)>59||(+m[2]===14&&+(m[3]||0)))return null;
  const minutes=(m[1]==='-'?-1:1)*(+m[2]*60+ +(m[3]||0));if(!minutes)return 'UTC';
  return `UTC${minutes<0?'-':'+'}${String(Math.floor(Math.abs(minutes)/60)).padStart(2,'0')}:${String(Math.abs(minutes)%60).padStart(2,'0')}`;
 }
 if(/^(?:協定世界時|世界標準時|世界時)$/.test(m[0]))return 'UTC';
 if(/^(?:JST|日本|東京)/i.test(m[0]))return 'JST';if(/^(?:KST|韓|韩)/i.test(m[0]))return 'KST';return 'UTC+08:00';
}
export function explicitTimeZoneOptions(item){
 const body=distinguishClockRange(warningBody(item)),labels=[...body.matchAll(zoneLabels)],unsupported=[...body.matchAll(unsupportedLabels)];
 if(!labels.length&&!unsupported.length)return undefined;
 const malformedOffsets=[...body.matchAll(/(?:UTC|GMT)\s*[+±∓-]\s*[\d:.]*/gi)].filter(m=>!labels.some(label=>label.index===m.index&&label[0].length===m[0].replace(/\.$/,'').trimEnd().length));
 const zones=labels.map(zoneForLabel),offsets=new Set(zones.map(timeZoneOffsetMinutes));
 const conflict=offsets.size>1||offsets.has(null)||unsupported.length||malformedOffsets.length||(/\d{4}Z\b/.test(body)&&[...offsets].some(x=>x!==0));
 return {defaultZone:conflict?null:zones[0],zoneEvidence:{kind:conflict?'explicit-time-zone-conflict':'explicit-body-time-zone',scope:'body',confidence:conflict?'unresolved':'explicit',raw:[...labels,...unsupported,...malformedOffsets].map(m=>m[0]),zones:[...new Set(zones.filter(Boolean))]},...(conflict?{zoneConflict:unsupported.length||malformedOffsets.length||offsets.has(null)?'unsupported-explicit-time-zone':'conflicting-explicit-time-zones'}:{})};
}
// Remove only recognized labels immediately attached to a four-digit clock.
// The original body and literal labels remain in originals/zoneEvidence.
export function normalizeTimeZoneClockLabels(text){return distinguishClockRange(text).replace(/(\d{4})\s*(?:\(\s*)?((?:UTC|GMT)(?:\s*[+-]\s*\d{1,2}(?::?\d{2})?)?|JST|KST)\s*\)?(?![A-Z])/gi,'$1 ');}
export function recognizedSource(item){
 if(!/^(?:(?:NAVTEX|NAVAREA|日本)航行警報|NAVTEX-English|(?:[一二三四五六七八九十]+管区)?地域航行警報):/.test(item.identity||''))return false;
 const links=item.sourceLinks?.length?item.sourceLinks:item.sourceUrl?[item.sourceUrl]:[];
 return !links.length||links.some(raw=>{try{const u=new URL(raw);return u.protocol==='https:'&&(u.hostname==='www1.kaiho.mlit.go.jp'||u.hostname==='www.msil.go.jp');}catch{return false;}});
}
function coordinates(item){
 const points=[];const walk=x=>{if(!Array.isArray(x))return;if(x.length>=2&&typeof x[0]==='number'&&typeof x[1]==='number'){points.push(x);return;}x.forEach(walk);};
 for(const g of item.geometries||[])walk(g.coordinates);
 if(!points.length)for(const s of item.shapes||[])for(const [lat,lon]of s.points||[])points.push([lon,lat]);
 return points;
}
const within=(points,box)=>points.length>0&&points.every(([lon,lat])=>lon>=box[0]&&lon<=box[1]&&lat>=box[2]&&lat<=box[3]);
const FOREIGN=/インド(?:東岸|西岸|洋)|アラビア|サハリン|カムチャツカ|ベーリング|メキシコ|カリフォルニア|オーストラリア|ニュージーランド|フィジー|ペルシア|ホルムズ|パキスタン|シンガポール|ベトナム|フィリピン|ルソン|ジャワ|マレー|アンダマン|ベンガル|コーラル|マリアナ|パラオ|南太平洋|北太平洋東部|南シナ海|中国|上海|ロシア|ハワイ/;
const DOMESTIC=/本州|北海道|四国|九州|沖縄|南西諸島|南方諸島|瀬戸内海|東京湾|新島|八戸|尻屋埼|響灘|犬吠埼|若狭湾|都井岬|五島列島|野島埼|宮古島|野母埼|入道埼|硫黄島|西之島|須美寿島|父島|母島|潮岬|駿河湾|紀伊水道|対馬|玄界灘|塩屋埼|福江島|御前埼|釧路|高知/;
// The reviewed Tanegashima-style relay has one unmarked coastal-area clock
// followed by explicit-UTC distant drop zones. Do not apply JST to those zones.
function reviewedCoastalLaunchScope(body){
 if(!/東シナ海及び北太平洋西部/.test(body)||!/ロケット打上げ/.test(body)||!/(?:\d{4}Z)/.test(body))return false;
 const clockPairs=[...body.matchAll(/\d{4}(Z)?\s*-\s*(?:翌日)?\d{4}(Z)?/g)];
 if(clockPairs.filter(m=>!m[1]&&!m[2]).length!==1)return false;
 const first=body.match(/\(1\)([^]*?)(?=\d{1,2}月\d{1,2}日)/)?.[1];if(!first)return false;
 const points=[...first.matchAll(/(\d{2})-(\d{2})-(\d{2})N\s+(\d{3})-(\d{2})-(\d{2})E/g)].map(m=>[+m[4]+ +m[5]/60+ +m[6]/3600,+m[1]+ +m[2]/60+ +m[3]/3600]);
 return points.length>=3&&within(points,[120,140,25,40]);
}
function decision(zone,id,scope,rule,extra={}){return {defaultZone:zone,zoneEvidence:{kind:'reviewed-source-convention',ruleId:id,scope,confidence:'high',reviewedAt:'2026-10-06',rule,...extra}};}
export function sourceTimeZoneOptions(item){
 if(!recognizedSource(item))return undefined;
 const id=item.identity,body=warningBody(item),points=coordinates(item);
 if(/地域航行警報:/.test(id)){
  if(FOREIGN.test(body)||points.length&&!within(points,[120,160,20,47]))return undefined;
  return {defaultZone:'JST',zoneEvidence:{kind:'official-series-convention',ruleId:'jcg-regional-jst-v1',scope:'地域航行警報',confidence:'high',url:REGIONAL_URL,rule:'日本標準時・24時間制0000から2400'}};
 }
 if(/^NAVAREA航行警報:|^NAVTEX-English:/.test(id))return decision('UTC','international-maritime-utc-v1','NAVAREA / English NAVTEX','国際航行警報のUTC基準。本文に異なる時区が明記されている場合は本文を優先。',{url:MSI_URL,sourceSection:'S-53 section 6, Part 2, Standard Message Element 7, printed page 26'});
 if(/^NAVTEX航行警報:/.test(id)&&!FOREIGN.test(body)&&(!points.length||within(points,[115,160,0,50])))return decision('JST','jcg-japanese-navtex-jst-v1','海上保安庁の日本語NAVTEX・日本周辺配信域','日本語NAVTEXの無印時刻はJST。台湾・朝鮮半島の地理的な現地時刻ではなく配信系列の基準。',{url:NAVTEX_URL,evidenceIds:['NAVTEX-English:26-1821','NAVTEX-English:26-1841','NAVTEX-English:26-1844','NAVTEX航行警報:26-1851 / 日本航行警報:26-3795'],evidenceBasis:'21 official English counterparts and 4 reviewed explicit-UTC Japanese counterparts'});
 if(/^日本航行警報:/.test(id)&&(DOMESTIC.test(body)&&(!points.length||within(points,[120,160,20,47]))||reviewedCoastalLaunchScope(body))&&!FOREIGN.test(body))return decision('JST','jcg-japan-coastal-jst-v1','日本航行警報の国内沿岸・島嶼警報','日本国内沿岸の無印時刻は、複数の公式英文NAVTEX対照例で一致したJSTを採用。本文のZ付き時刻はUTCのまま。',{url:JAPAN_URL,evidenceIds:['日本航行警報:26-3730','日本航行警報:26-3783','日本航行警報:26-3782','日本航行警報:26-3791'],evidenceBasis:'21 official English NAVTEX counterparts matched to Japan warnings'});
 // Reviewed overseas date-only relay contexts, deliberately not a universal
 // Japan-warning or location=>local-time rule. International MSI convention
 // supplies calendar boundaries, while the all-day treatment is user policy.
 if(/^日本航行警報:/.test(id)&&!/(?:\d{4}(?:Z|\s*[-時])|\d{1,2}:\d{2}|\d{1,2}時|日出|日没|現地)/.test(body)&&/\d{1,2}月\d{1,2}日\s*-\s*(?:\d{1,2}月)?\d{1,2}日/.test(body)){
  const scope=/インド[東西]岸/.test(body)&&within(points,[65,95,5,30])?'インド沿岸':/アラビア海/.test(body)&&within(points,[45,80,0,30])?'アラビア海':/サハリン[東西]岸/.test(body)&&within(points,[138,148,45,55])?'サハリン沿岸':null;
  if(scope)return decision('UTC','jcg-overseas-date-only-utc-v1',`日本航行警報・${scope}・日付のみの活動期間`,'海外の国際航行警報の転載文脈からUTC日界を採用。地域の現地時刻や日本の発表日時を活動時刻に代入しない。',{url:MSI_URL,sourceSection:'S-53 section 6, Part 2, Standard Message Element 7, printed page 26',sourceUrl:JAPAN_URL,confidence:'contextual',inferred:true,limitations:'日付のみの全日解釈。個別原報の明示的なUTC記載と同じ証拠強度ではない。'});
 }
 return undefined;
}
