/** GICOMS table schedules with explicit-clock precedence and scoped source conventions. */
import {koreaTimeBasis,koreaScheduleConstraint,KOREA_KST_BASIS,KOREA_KST_DISCLOSURE,type KoreaTimeBasis} from "./nav-international-time-evidence";
export {KOREA_KST_BASIS,KOREA_KST_DISCLOSURE};
export type KoreaPeriod={start:number;end:number};
export type KoreaScheduleRow={sourceRow:string;areaText:string;rawHtml:string;literalPeriods:{date:string;startClock:string;endClock:string}[];validityPeriods:KoreaPeriod[];error?:string};
const plain=(s:string)=>s.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:div|p)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
export function koreaExplicitCancellation(html:string){
 const title=plain(html.match(/<th\b[^>]*class="title"[^>]*>([\s\S]*?)<\/th>/i)?.[1]||'');
 const body=plain(html.match(/<article\b[^>]*class="board_wrap"[^>]*>([\s\S]*?)<\/article>/i)?.[1]||'').replace(/\s+/g,'');
 return /취소|철회|해제/.test(title)||/(?:본|해당|동)(?:해상)?(?:사격)?(?:훈련|사격)(?:은|이|을)?(?:전면)?(?:취소|철회|해제)(?:되었|됩니다|합니다|됨)/.test(body);
}
function koreaCancellationMention(html:string){const article=html.match(/<article\b[^>]*class="board_wrap"[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html;return /취소|철회|해제/.test(plain(article.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')));}
export function koreaScheduleFields(html:string){
 const title=plain(html.match(/<th\b[^>]*class="title"[^>]*>([\s\S]*?)<\/th>/i)?.[1]||'');
 const article=html.match(/<article\b[^>]*class="board_wrap"[^>]*>([\s\S]*?)<\/article>/i)?.[1]||'';
 const text=plain(article);
 const rule=koreaTimeBasis({id:'KR-GICOMS-'+(title.match(/\((\d{2}-\d+)\)/)?.[1]||'unknown'),sourceCountry:'KR',sourceUrl:'https://www.gicoms.go.kr/know/know_03_view.do',text:title+'\n'+text,issued:null,start:null,end:null});
 const eligible=Boolean(rule.basis)&&!koreaScheduleConstraint(title+'\n'+text);
 const table=article.match(/<table\b[^>]*class="list_know03View"[^>]*>([\s\S]*?)<\/table>/i)?.[1]||'';
 const rows:KoreaScheduleRow[]=[];
 for(const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);if(cells.length!==5)continue;
  const c=cells.map(plain),sourceRow=c[0],row:KoreaScheduleRow={sourceRow,areaText:c[1],rawHtml:tr[0],literalPeriods:[],validityPeriods:[]};rows.push(row);
  if(!/^\d+$/.test(sourceRow)){row.error='invalid-row-id';continue;}
  const dates=c[2].split(/\n/).map(s=>s.trim()).filter(Boolean),times=c[3].split(/\n/).map(s=>s.trim()).filter(Boolean);
  if(!dates.length||dates.length!==times.length){row.error='missing-or-unpaired-date-time';continue;}
  for(let i=0;i<dates.length;i++){
   const m=/^(\d{2}):(\d{2})\s*~\s*(\d{2}):(\d{2})$/.exec(times[i]);
   if(!m||+m[1]>23||+m[2]>59||+m[3]>23||+m[4]>59||`${m[1]}:${m[2]}`>=`${m[3]}:${m[4]}`){row.error='invalid-or-ambiguous-clock';break;}
   const date=dates[i],day=Date.parse(date+'T00:00:00Z');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||+date.slice(0,4)<2000||+date.slice(0,4)>2100||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==date){row.error='invalid-date';break;}
   row.literalPeriods.push({date,startClock:`${m[1]}:${m[2]}`,endClock:`${m[3]}:${m[4]}`});
  }
  if(row.error){row.literalPeriods=[];continue;}
  if(eligible)row.validityPeriods=row.literalPeriods.map(p=>({start:Date.parse(`${p.date}T${p.startClock}:00Z`)-rule.basis!.offsetMinutes*60000,end:Date.parse(`${p.date}T${p.endClock}:00Z`)-rule.basis!.offsetMinutes*60000}));
 }
 const periods=rows.flatMap(r=>r.validityPeriods);
 return {eligible,rows,fields:{validityPeriods:periods,start:periods.length?Math.min(...periods.map(p=>p.start)):null,end:periods.length?Math.max(...periods.map(p=>p.end)):null,timeUncertain:true,lifecycleUncertain:true},timeBasis:periods.length?rule.basis:null,warnings:periods.length?[rule.basis!.disclosure]:rule.reason==='timezone-conflict'?['本文のタイムゾーン指定が矛盾しています。']:rule.reason==='unsupported-timezone'?['本文の現地時刻の指定を確認してください。']:[]};
}
/** Re-run the EXISTING geometry parser on one row at a time: association survives
 * invalid rows, zero shapes, circles, polygons, and one row producing several shapes.
 * Do not zip a flattened shape array with schedule rows. */
export function koreaShapesWithSchedules<S>(html:string,parseShapes:(html:string)=>S[]):(S&{sourceRow:string;validityPeriods:KoreaPeriod[];timeBasis:KoreaTimeBasis|null;timeUncertain:true})[]{
 const schedule=koreaScheduleFields(html);
 return schedule.rows.flatMap(row=>parseShapes(`<table class="list_know03View">${row.rawHtml}</table>`).map(shape=>({...shape,sourceRow:row.sourceRow,validityPeriods:row.validityPeriods,timeBasis:row.validityPeriods.length?schedule.timeBasis:null,timeUncertain:true as const})));
}
export const KOREA_EMPTY_REFRESH_WARNING='最新のGICOMS応答で日付・時刻の表が欠落。前回取得した内容を保持しています。更新内容は未確認です。';
export function preserveKoreaEmptyRefresh<T extends {id:string;text:string;warnings:string[];lifecycleUncertain?:boolean}>(previous:T|undefined,incoming:T,html:string):{notice:T;preserved:boolean;retry:boolean}{
 if(!previous||previous.id!==incoming.id)return {notice:incoming,preserved:false,retry:false};
 const title=plain(html.match(/<th\b[^>]*class="title"[^>]*>([\s\S]*?)<\/th>/i)?.[1]||'');
 if(koreaExplicitCancellation(html)||koreaCancellationMention(html))return {notice:incoming,preserved:false,retry:false};
 // Prior literal table dates AND clocks, never header dates or prose dates alone.
 const oldTable=previous.text.split('관련해도')[1]?.split('자료출처')[0]||'';
 const hadSchedule=/\b\d{4}-\d{2}-\d{2}\b/.test(oldTable)&&/\b\d{2}:\d{2}\s*~\s*\d{2}:\d{2}\b/.test(oldTable);
 const fresh=koreaScheduleFields(html);if(!hadSchedule||fresh.rows.some(r=>r.literalPeriods.length))return {notice:incoming,preserved:false,retry:false};
 return {notice:{...previous,lifecycleUncertain:true,warnings:[...new Set([...previous.warnings,KOREA_EMPTY_REFRESH_WARNING])]},preserved:true,retry:true};
}
/** Restore only literal stored row blocks for read-time re-evaluation. No dates,
 * clocks, coordinates or rows are inferred from warning number or header dates. */
export function koreaSavedTableHtml(text:string):string {
 const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const title=text.match(/\(\d{2}-\d+\)[^\n\r]*/)?.[0]||'';
 const body=text.split('관련해도')[1]?.split('자료출처')[0]||'';
 const rows=[...body.matchAll(/(?:^|\n)\s*(\d+)\s*\n([\s\S]*?)((?:\s*\d{4}-\d{2}-\d{2}\s*\n)+)((?:\s*\d{2}:\d{2}\s*~\s*\d{2}:\d{2}\s*\n)+)\s*(\d+)\s*(?=\n|$)/g)].map(m=>'<tr>'+[m[1],m[2],m[3],m[4],m[5]].map(s=>'<td>'+escape(s.trim()).replace(/\n/g,'<br/>')+'</td>').join('')+'</tr>').join('');
 return `<th class="title">${escape(title)}</th><article class="board_wrap"><p>${escape(text)}</p><table class="list_know03View">${rows}</table></article>`;
}
