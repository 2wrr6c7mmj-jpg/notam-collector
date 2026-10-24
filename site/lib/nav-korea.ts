import {koreaExplicitCancellation,koreaScheduleFields,koreaShapesWithSchedules,koreaSavedTableHtml,preserveKoreaEmptyRefresh,KOREA_EMPTY_REFRESH_WARNING} from "./nav-korea-schedule";
import type { Notice, Point, Shape } from "./notam";
import type { NavSource } from "./nav-sources";
import type { SourceRecord } from "./nav-store";
export const koreaMaritimeSource: NavSource = {id:"kr-gicoms",name:"GICOMS (KHOA転載)",region:"韓国",country:"KR",parser:"gicoms-html",url:"https://www.gicoms.go.kr/know/know_03.do"};
const origin="https://www.gicoms.go.kr";
const plain=(s:string)=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/(?:div|tr|td|th|p)>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/gi," ").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&amp;/gi,"&").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/[ \t]+/g," ").replace(/\n\s*\n/g,"\n").trim();
export function koreaListing(html:string):string[]{return [...new Set([...html.matchAll(/fn_egov_inqire_notice\(['"](\d{2}-\d+)['"]\)/g)].map(m=>`${origin}/know/know_03_view.do?docNo=${m[1]}`))];}
export function koreaShapes(html:string):Shape[]{
 const table=html.match(/<table\b[^>]*class="list_know03View"[^>]*>([\s\S]*?)<\/table>/i)?.[1]||"";
 return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap<Shape>(row=>{
  const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]; if(cells.length<2)return [];
  const t=plain(cells[1][1]), p:Point[]=[]; let invalid=false;
  for(const m of t.matchAll(/(\d{1,2})-(\d{1,2})-(\d{1,2}(?:\.\d+)?)N\s*,\s*(\d{1,3})-(\d{1,2})-(\d{1,2}(?:\.\d+)?)E/g)){
   if(+m[2]>=60||+m[3]>=60||+m[5]>=60||+m[6]>=60){invalid=true;continue;}
   const lat=+m[1]+ +m[2]/60+ +m[3]/3600,lon=+m[4]+ +m[5]/60+ +m[6]/3600;
   if(lat<=90&&lon<=180)p.push([lat,lon]); else invalid=true;
  }
  if(invalid)return [];
  if(/해당 지점을 순차 연결한 선내 해역/.test(t)&&p.length>=3)return [{kind:"polygon",points:[...p,p[0]],provenance:"text"}];
  return p.map(point=>({kind:"point",points:[point],provenance:"text"}));
 });
}
export function parseKoreaWarning(html:string,url:string):Notice{
 const title=plain(html.match(/<th\b[^>]*class="title"[^>]*>([\s\S]*?)<\/th>/i)?.[1]||"");
 const id=title.match(/^\((\d{2}-\d+)\)/)?.[1]; if(!id||new URL(url).searchParams.get("docNo")!==id)throw new Error("警告詳細の識別番号を確認できません");
 const article=html.match(/<article\b[^>]*class="board_wrap"[^>]*>([\s\S]*?)<\/article>/i)?.[1]; if(!article)throw new Error("警告本文を確認できません");
 const text=plain(article),schedule=koreaScheduleFields(html),shapes=schedule.rows.length?koreaShapesWithSchedules(html,koreaShapes):koreaShapes(article);
 // Reuse the source convention unless this notice gives a different explicit clock.
 // Missing or unpaired table dates still do not become activity intervals.
 return {cancelled:koreaExplicitCancellation(html),id:`KR-GICOMS-${id}`,location:"KR",text,issued:null,start:schedule.fields.start,end:schedule.fields.end,permanent:false,purpose:/사격|발사|훈련/.test(text)?"firing":"other",shapes,warnings:[...(schedule.warnings.length?schedule.warnings:["実施日程の表が不足しているか、日付と時刻の対応を確認できません。"]),...(shapes.length?[]:["位置の自動判定ができません。公式原文を確認してください。"])],sourceUrl:url,sourceName:koreaMaritimeSource.name,sourceCountry:"KR",regions:["KR"],validityPeriods:schedule.fields.validityPeriods,timeUncertain:true,lifecycleUncertain:true,...(schedule.timeBasis?{maritimeTimeBasis:schedule.timeBasis}:{})};
}
export function recoverKoreaSchedule(item:Notice):Notice {
 const html=koreaSavedTableHtml(item.text),schedule=koreaScheduleFields(html);
 // Replace the obsolete blanket timezone refusal with the actual table issue.
 // A source convention can be known even when this response lost its rows.
 item={...item,warnings:[...new Set([...item.warnings.map(w=>w.includes('タイムゾーン未確認のためUTC有効期間は未確定')?'実施日程の表が不足しているか、日付と時刻の対応を確認できません。':w),...schedule.warnings])]};
 if(koreaExplicitCancellation(html))return {...item,cancelled:true,start:null,end:null,validityPeriods:[],shapes:[],maritimeTimeBasis:undefined,timeUncertain:false,warnings:[...new Set([...item.warnings,"韓国原文で訓練の取消しが明示されています。"]) ]};
 if(!schedule.fields.validityPeriods.length){
   if(item.maritimeTimeBasis)return {...item,start:null,end:null,validityPeriods:[],maritimeTimeBasis:undefined,timeUncertain:true,lifecycleUncertain:true,shapes:item.shapes.map(s=>({...s,validityPeriods:[]})),warnings:[...new Set([...item.warnings,"現在の原文から以前の換算日程を再確認できません。日程を保留しています。"]) ]};
   return item;
 }
 const tagged=koreaShapesWithSchedules(html,koreaShapes);
 const unique=[...new Map(schedule.fields.validityPeriods.map(p=>[`${p.start}/${p.end}`,p])).values()];
 return {...item,...schedule.fields,validityPeriods:unique,shapes:item.cancelled?[]:tagged.length?tagged:item.shapes,maritimeTimeBasis:schedule.timeBasis!,warnings:[...new Set([...item.warnings.filter(w=>!w.includes("タイムゾーン未確認")&&!w.includes("公表資料の慣例")&&!w.includes("日付と時刻の対応を確認できません")),...schedule.warnings])]};
}
export async function collectKoreaMaritime(source:NavSource,previous:SourceRecord,fetcher:typeof fetch=fetch):Promise<SourceRecord>{
 const checkedAt=Date.now(),deadline=checkedAt+25000,items=new Map(previous.items.map(n=>[n.id,n]));let pages=0,failed=0,success=0;
 const valid=(u:string)=>{try{const v=new URL(u);return v.origin===origin&&v.pathname==="/know/know_03_view.do"&&/^\d{2}-\d+$/.test(v.searchParams.get("docNo")||"");}catch{return false;}};
 let queue=[...new Set([...(previous.retryArticles||[]),...(previous.pendingArticles||[])].filter(valid))];const retry:string[]=[];
 async function read(url:string){const response=await fetcher(url,{headers:{Accept:"text/html"},signal:AbortSignal.timeout(Math.max(1,Math.min(12000,deadline-Date.now())))});if(!response.ok)throw new Error(`HTTP ${response.status}`);if(response.url&&new URL(response.url).hostname.replace(/^www\./,"")!=="gicoms.go.kr")throw new Error("公式サイト外へ転送");const html=await response.text();if(html.length>2000000)throw new Error("ページサイズ上限");return html;}
 try{
  const listing=await read(source.url);pages++;const links=koreaListing(listing);if(!links.length)throw new Error("一覧に警告番号が見つかりません");queue=[...new Set([...queue,...links])];
  while(queue.length&&Date.now()<deadline-1500&&success+failed<10){const batch=queue.splice(0,Math.min(3,10-success-failed));await Promise.all(batch.map(async url=>{try{const html=await read(url),notice=parseKoreaWarning(html,url),guard=preserveKoreaEmptyRefresh(items.get(notice.id),notice,html);items.set(notice.id,recoverKoreaSchedule(guard.notice));pages++;if(guard.preserved){failed++;retry.push(url);}else success++;}catch{failed++;retry.push(url);}}));}
  const result=[...items.values()];return {items:result,pendingArticles:queue,retryArticles:retry,status:{...source,state:"partial",checkedAt,fetchedAt:success?checkedAt:previous.status.fetchedAt,count:result.length,pages,detail:`公開一覧の最新10件を取得。全履歴は未収集。取得${success}件・再試行${retry.length}件・待機${queue.length}件。国内訓練の日時は公表資料の慣例に基づき韓国時間で換算。空の再取得では保存原文を保持。`}};
 }catch(error){return {...previous,pendingArticles:queue,retryArticles:retry,status:{...source,state:"error",checkedAt,fetchedAt:previous.status.fetchedAt,count:previous.items.length,pages,detail:`公式サイト取得失敗: ${error instanceof Error?error.message:String(error)}。保存済み情報を維持。`}};}
}
