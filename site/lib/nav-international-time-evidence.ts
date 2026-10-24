/** Literal source evidence plus separately typed, source-rule-based UTC conversion. */
export type InternationalTimeNotice = {id:string; sourceCountry?:string; sourceUrl?:string; cancelled?:boolean; text:string; issued:number|null; start:number|null; end:number|null; timeUncertain?:boolean; validityPeriods?:{start:number;end:number}[]};
export type InternationalTimeEvidence = {
  kind:'calendar-only'|'source-clock'|'end-only'|'open-ended'|'partial-utc';
  display:string; raw:string; timezone:'UTC'|'Asia/Seoul'|'Asia/Tokyo'|'source-explicit'|'unverified';
  /** Source strings only. These values have no UTC timestamp interpretation. */
  sourceWindows?:{date:string;startClock:string;endClock:string;sourceRow?:number}[];
  caution:string;
};
const normalize=(s:string)=>s.normalize('NFKC').replace(/\r/g,'').replace(/[ \t]+/g,' ');
const validDay=(s:string)=>{const m=s.match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return false;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3];};
const clock=(s:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function koreaSourceClockWindows(text:string) {
  const t=normalize(text),table=t.split(/관련해도\s*\n/)[1]?.split(/자료출처/)[0];
  if(!table)return [];
  const out:{date:string;startClock:string;endClock:string;sourceRow?:number}[]=[];
  // Exact whole lines only: no substring dates, month/year copying, overnight
  // interpretation, sorting before pairing, or borrowing header dates.
  const lines=table.split('\n').map(line=>line.trim()).filter(Boolean);
  for(let i=0;i<lines.length;){
    if(!/^20\d{2}-\d{2}-\d{2}$/.test(lines[i])){i++;continue;}
    const dates:string[]=[],times:RegExpMatchArray[]=[];
    while(i<lines.length&&/^20\d{2}-\d{2}-\d{2}$/.test(lines[i]))dates.push(lines[i++]);
    let m:RegExpMatchArray|null;
    while(i<lines.length&&(m=lines[i].match(/^(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})$/))){times.push(m);i++;}
    if(dates.length!==times.length||dates.length>366||!dates.every(validDay)||times.some(x=>!clock(x[1])||!clock(x[2])))continue;
    for(let j=0;j<dates.length;j++)out.push({date:dates[j],startClock:times[j][1],endClock:times[j][2]});
  }
  return out;
}
/** Reusable source-clock rules. Explicit source labels take precedence over
 * the named source's publication convention; conflicting labels stay unresolved. */
export type KoreaTimeBasis = {zone:string;offsetMinutes:number;basis:string;confidence:'high';reviewRequired:boolean;scope:string;sourceUrl:string;sourceDate?:string;sourceTitle?:string;quotedLabel?:string;disclosure:string};
export const KOREA_KST_DISCLOSURE='韓国時間（UTC+9）';
export const KOREA_KST_BASIS:KoreaTimeBasis={zone:'Asia/Seoul',offsetMinutes:540,basis:'historical-source-convention-inference',confidence:'high',reviewRequired:true,scope:'KHOA-origin domestic maritime firing/training tables only',sourceUrl:'https://www.oneksa.kr/data/board/doc/navigation_info/1802070114189_1.pdf',sourceDate:'2018-02-07',sourceTitle:'KHOA Korean Navigational Warning No.18-56',quotedLabel:'Date & Time (KST)',disclosure:KOREA_KST_DISCLOSURE};
// The Korean mirror of Japanese NAVTEX 26-1844 preserves the Japanese
// Oct 1–31 07:00–19:00 table and all five vertices. The official English
// counterpart gives Sep 30–Oct 30 2200Z–1000Z, establishing UTC+9 for this
// reformatted source series independently of the issuer country's clock.
export const KOREA_JCG_TIME_BASIS:KoreaTimeBasis={zone:'Asia/Tokyo',offsetMinutes:540,basis:'parallel-official-source-convention',confidence:'high',reviewRequired:true,scope:'GICOMS/KHOA Japanese Coast Guard domestic NAVTEX firing-table republications; excludes NAVAREA and explicit foreign clock labels',sourceUrl:'https://www1.kaiho.mlit.go.jp/TUHO/keiho/cgi/disp_warnings.cgi?TYPE=NAVTEX&TANA=261844&LANG=EG',sourceDate:'2026-10-05',sourceTitle:'NAVTEX 26-1844 bilingual schedule and five-vertex match to GICOMS 26-332',quotedLabel:'2200Z TO 1000Z COMMENCING DAILY 30 SEP TO 30 OCT',disclosure:'日本時間（UTC+9）'};
export function koreaTimeBasis(n:InternationalTimeNotice):{basis:KoreaTimeBasis|null;reason?:string}{
 const t=normalize(n.text),title=t.match(/\(\d{2}-\d+\)[^\n]*/)?.[0]||'';
 let knownSource=/^KR-GICOMS-\d{2}-\d+$/.test(n.id);
 try{const url=new URL(n.sourceUrl||'');knownSource ||= url.hostname.replace(/^www\./,'')==='gicoms.go.kr'&&url.pathname==='/know/know_03_view.do';}catch{}
 if(n.sourceCountry!=='KR'||!knownSource)return {basis:null,reason:'unrecognized-source'};
 const offsets:number[]=[],labels:string[]=[];
 // Consume the complete signed-offset token before validating it. A valid
 // prefix must not turn UTC+9.5, UTC+09:000 or UTC+09:30:20 into another clock.
 const remaining=t.replace(/\b(?:UTC|GMT)\s*([+-])\s*([^\s;(){}\[\]<>。！？]+)/gi,(raw,sign,token)=>{const m=token.replace(/[.,]$/,'').match(/^(?:(\d{1,2})(?::(\d{2}))?|(\d{2})(\d{2}))$/);if(!m){offsets.push(NaN);labels.push(raw);return '';}const h=+(m[1]||m[3]),minutes=+(m[2]||m[4]||0);offsets.push(h>14||minutes>59||h===14&&minutes!==0?NaN:(sign==='-'?-1:1)*(h*60+minutes));labels.push(raw);return '';});
 if(/\bUTC\b|\bGMT\b|협정\s*세계시|세계\s*표준시|世界標準時/i.test(remaining)){offsets.push(0);labels.push('UTC');}
 if(/\bKST\b|한국\s*(?:표준시|시간)|대한민국\s*표준시|韓国時間/i.test(remaining)){offsets.push(540);labels.push('KST');}
 if(/\bJST\b|일본\s*(?:표준시|시간)|日本(?:標準時|時間)/i.test(remaining)){offsets.push(540);labels.push('JST');}
 if(/\b(?:CST|EST|EDT|PST|PDT|MSK)\b|중국\s*(?:표준시|시간)|북경\s*시간|베이징\s*시간|北京時間|当地时间|當地時間|현지\s*(?:시간|시각)|\bLOCAL\s+TIME\b/i.test(remaining))return {basis:null,reason:'unsupported-timezone'};
 if(/\b(?:UTC|GMT)\s*[+±∓−–—-]/i.test(remaining))return {basis:null,reason:'unsupported-timezone'};
 if(offsets.some(x=>!Number.isFinite(x)))return {basis:null,reason:'unsupported-timezone'};
 if(new Set(offsets).size>1)return {basis:null,reason:'timezone-conflict'};
 if(offsets.length){const offsetMinutes=offsets[0],zone=offsetMinutes===0?'UTC':labels.includes('JST')?'Asia/Tokyo':offsetMinutes===540?'Asia/Seoul':`UTC${offsetMinutes<0?'-':'+'}${Math.floor(Math.abs(offsetMinutes)/60)}:${String(Math.abs(offsetMinutes)%60).padStart(2,'0')}`;return {basis:{zone,offsetMinutes,basis:'explicit-source-timezone',confidence:'high',reviewRequired:false,scope:'This GICOMS/KHOA notice explicitly labelled source clock',sourceUrl:n.sourceUrl||'https://www.gicoms.go.kr/know/know_03.do',quotedLabel:labels.join('; '),disclosure:zone==='Asia/Seoul'?KOREA_KST_DISCLOSURE:zone==='Asia/Tokyo'?'日本時間（UTC+9）':zone}};}
 const domestic=/해상(?:사격)?훈련/.test(title)&&/합동참모본부|해군작전사령부|해양정보단|해양경찰청/.test(title)&&!/일본|북한|중국|러시아|NAVAREA|해상보안청/i.test(title);
 const japaneseMirror=/일본\s*해상보안청/.test(title)&&/해상사격/.test(t)&&/항행경보\s*\(\s*No\.\s*\d{2}-\d{4,5}\s*\)/i.test(t)&&!/NAVAREA|\d{4}Z\b/i.test(t);
 return domestic?{basis:KOREA_KST_BASIS}:japaneseMirror?{basis:KOREA_JCG_TIME_BASIS}:{basis:null,reason:'source-convention-unresolved'};
}
export function koreaScheduleConstraint(text:string):string|undefined{
 const t=normalize(text);
 if(/취소|철회|해제/.test(t))return 'cancellation-or-lifecycle-change';
 if(/시간\s*미상|시간\s*미정|추후.{0,12}(?:통보|공지)|예비\s*(?:일|시간)|(?:기상|상황|조건).{0,20}(?:따라|경우)|연기/.test(t))return 'activity-condition-unresolved';
 return undefined;
}
/** Only exact, already paired table rows become UTC intervals. No header-date
 * copying, publication dates, date sorting before pairing, or overnight guesses. */
export function koreaSourceSchedule(n:InternationalTimeNotice){
 const rule=koreaTimeBasis(n),reason=n.cancelled?'cancelled':koreaScheduleConstraint(n.text)||rule.reason;
 const windows=koreaSourceClockWindows(n.text),periods:{start:number;end:number}[]=[];
 if(!reason&&rule.basis)for(const w of windows){
  if(w.startClock>=w.endClock)continue;
  periods.push({start:Date.parse(`${w.date}T${w.startClock}:00Z`)-rule.basis.offsetMinutes*60000,end:Date.parse(`${w.date}T${w.endClock}:00Z`)-rule.basis.offsetMinutes*60000});
 }
 const unique=[...new Map(periods.map(p=>[`${p.start}/${p.end}`,p])).values()].sort((a,b)=>a.start-b.start||a.end-b.end);
 const table=normalize(n.text).split(/관련해도\s*\n/)[1]?.split(/자료출처/)[0]||'';
 const complete=periods.length>0&&periods.length===(table.match(/20\d{2}-\d{2}-\d{2}/g)||[]).length&&(table.match(/\d{2}:\d{2}\s*~\s*\d{2}:\d{2}/g)||[]).length===periods.length;
 return {periods:unique,basis:rule.basis,complete,reason,sourceWindows:windows};
}
export function internationalTimeEvidence(n:InternationalTimeNotice):InternationalTimeEvidence|null {
  if(n.sourceCountry==='TW'){
    const t=normalize(n.text),title=t.split('\n')[0];
    // Compact ROC prefix such as 1150922 is publication metadata, never an activity date.
    // Keep partial-month, listed-day, alternate and cancellation qualifiers as source text.
    const candidate=title.match(/(?:\d{3}年|\d{1,2}月)[\d年月日第季上中下半旬份至及、, ()（）預備演時起\-~]*/)?.[0].replace(/[ \-~]+$/,'');
    if(!candidate)return null;
    const revised=/取消|修正|修訂|變更|調整|更新/.test(t);
    return {kind:'calendar-only',display:`原文日程: ${candidate}（実施時刻未確定）`,raw:title,timezone:'unverified',caution:`掲載日・月全体を連続した有効期間として扱いません。添付原文の実施時刻・時区・休止時間を要確認。${revised?'取消・変更の記載あり。最新の添付原文を確認してください。':''}`};
  }
  if(n.sourceCountry==='KR'){
    const t=normalize(n.text),start=t.match(/시작일\s*\n\s*(20\d{2}-\d{2}-\d{2}|없음)/)?.[1],end=t.match(/종료일\s*\n\s*(20\d{2}-\d{2}-\d{2}|없음)/)?.[1];
    const schedule=koreaSourceSchedule(n),windows=schedule.sourceWindows,basis=schedule.basis;
    if(windows.length){const first=windows[0],zone=basis?.disclosure||'タイムゾーン要確認';return {kind:'source-clock',display:`原文日程: ${first.date} ${first.startClock}–${first.endClock}${windows.length>1?` ほか${windows.length-1}区間`:''}（${zone}）`,raw:t.split(/관련해도\s*\n/)[1]?.split(/자료출처/)[0]?.trim()||'',timezone:basis?(basis.zone==='UTC'||basis.zone==='Asia/Seoul'||basis.zone==='Asia/Tokyo'?basis.zone:'source-explicit'):'unverified',sourceWindows:windows,caution:schedule.reason==='timezone-conflict'?'本文のタイムゾーン指定が矛盾しています。適用する時刻を確認してください。':schedule.reason==='unsupported-timezone'?'本文の現地時刻の指定を確認してください。':schedule.reason==='source-convention-unresolved'?'転載元の時刻と掲載表の時刻の対応を確認してください。':schedule.reason?'日程の取消・変更・実施条件を確認してください。':!schedule.periods.length?'日付と時刻の対応・実施条件を確認してください。':'日付と時刻は掲載順で対応。区域ごとの日程・変更は原文を確認してください。'};}
    if(start&&validDay(start))return {kind:'calendar-only',display:`原文日付: ${start}${end&&validDay(end)&&end!==start?`～${end}`:''}（実施時刻未確定）`,raw:`시작일 ${start}; 종료일 ${end||'未記載'}`,timezone:basis?(basis.zone==='UTC'||basis.zone==='Asia/Seoul'||basis.zone==='Asia/Tokyo'?basis.zone:'source-explicit'):'unverified',caution:'概要の日付のみ。本文の実施時刻・終了条件を確認してください。'};
    return null;
  }
  if(n.sourceCountry==='PH'){
    if(n.start===null&&n.end!==null&&Number.isFinite(n.end))return {kind:'end-only',display:`終了: ${new Date(n.end).toISOString().replace('T',' ').replace(':00.000Z',' UTC')}（開始未確認）`,raw:normalize(n.text).replace(/\s+/g,' ').match(/\bUNTIL \d{6} UTC [A-Z]+ 20\d{2}\b/)?.[0]||'',timezone:'UTC',caution:'IN PROGRESSは開始時刻を示しません。取消予定時刻は活動終了へ流用していません。'};
    const t=normalize(n.text).replace(/\s+/g,' '),calendar=t.match(/\b(?:UNTIL \d{1,2}|\d{1,2} TO \d{1,2}) (?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) 20\d{2}\b/);
    if(calendar)return {kind:'calendar-only',display:`原文日程: ${calendar[0]}（時刻・時区未確認）`,raw:calendar[0],timezone:'unverified',caution:'日付だけの予定を午前0時からの有効期間に変換しません。'};
    if(/UNTIL FURTHER NOTICE/.test(t))return {kind:'open-ended',display:'原文: 追って通知するまで（開始・終了時刻未確認）',raw:'UNTIL FURTHER NOTICE',timezone:'unverified',caution:'公表時刻を活動開始に流用しません。'};
    return null;
  }
  if(n.sourceCountry==='JP'){
    const t=normalize(n.text).replace(/\s+/g,' '),activity=t.split(/\bCANCEL THIS MSG\b/)[0];
    const partial=activity.match(/\b\d{6}Z TO \d{6}Z [A-Z]{3}, ALTERNATE [^.]+/);
    if(partial)return {kind:'partial-utc',display:`原文UTC日程: ${partial[0]}`,raw:partial[0],timezone:'UTC',caution:'主日程だけを有効区間へ採用可能。予備日は実施条件・取消時刻との整合が未確認です。'};
    const end=activity.match(/\bUNTIL \d{2} [A-Z]{3} 20\d{2}/);
    if(end)return {kind:'calendar-only',display:`原文日程: ${end[0]}（終了時刻未確認）`,raw:end[0],timezone:'unverified',caution:'開始・終了時刻は不明。メッセージ取消時刻を活動終了へ転用しません。'};
    if(/UNTIL (?:FURTHER|\d{2} [A-Z]{3} TO UNTIL FURTHER) NOTICE/.test(activity)||/UNTIL FURTHER NOTICE/.test(activity))return {kind:'open-ended',display:'原文: 追って通知するまで（活動期間未確定）',raw:activity.match(/(?:\d{2} [A-Z]{3} TO )?UNTIL FURTHER NOTICE/)?.[0]||'UNTIL FURTHER NOTICE',timezone:'unverified',caution:'掲載時刻は活動開始ではありません。'};
  }
  return null;
}
