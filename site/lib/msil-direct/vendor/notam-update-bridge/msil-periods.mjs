import {msilSourceSchedule} from './msil-source-schedule.mjs';
import {sourceTimeZoneOptions,explicitTimeZoneOptions,timeZoneOffsetMinutes,normalizeTimeZoneClockLabels,stripTimeZoneLabels} from './msil-time-basis.mjs';
// Cabinet Office published holiday/holiday-substitute dates, checked 2026-10-05.
// https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
const JP_HOLIDAYS={2026:new Set('1-1 1-12 2-11 2-23 3-20 4-29 5-3 5-4 5-5 5-6 7-20 8-11 9-21 9-22 9-23 10-12 11-3 11-23'.split(' ')),2027:new Set('1-1 1-11 2-11 2-23 3-21 3-22 4-29 5-3 5-4 5-5 7-19 8-11 9-20 9-23 10-11 11-3 11-23'.split(' '))};
const HOLIDAY_URL='https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html';
const DAY=86400000,MONTHS='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const normalize=s=>s.normalize('NFKC').replace(/[−―‐–—－〜～~]/g,'-').replace(/\r/g,'');
function stamp(y,m,d,clock='0000',offset=0){const h=+clock.slice(0,2),mi=+clock.slice(2),t=Date.UTC(y,m-1,d),v=new Date(t);if(!Number.isInteger(y)||y<1900||v.getUTCFullYear()!==y||v.getUTCMonth()!==m-1||v.getUTCDate()!==d||h>24||mi>59||(h===24&&mi))return null;return t+(h*60+mi-offset)*60000;}
const headingMonth=raw=>Number(raw?.match(/20\d{2}(?:年|\/)(\d{1,2})(?:月|\/)/)?.[1]);
function heading(item){const text=normalizeTimeZoneClockLabels(normalize(item.text)),lines=text.split('\n'),header=lines.slice(0,4).find(l=>(/発表日時|航行警報/.test(l)&&/20\d{2}年/.test(l))||/^NO\.[\d-]+\s+Date:20\d{2}\//.test(l));const y=header?.match(/(20\d{2})(?:年|\/)/);return {text,year:y?+y[1]:null,yearEvidence:header||null,body:lines.filter(l=>!/^\s*(?:NAVAREA|NAVTEX|日本)航行警報[：:]/.test(l)&&!/^NO\.[\d-]+\s+Date:/.test(l)&&!l.includes('発表日時')&&!(/地域航行警報/.test(l)&&/番号/.test(l))&&!/^\s*\d{1,2}月\d{1,2}日\d{4}発表/.test(l)&&!l.includes('[利用上の制限事項]')).join('\n')};}
function englishDays(raw,year){
 const spec=raw.trim().replace(/[, ]+$/,''),tokens=[...spec.matchAll(/(\d{2})(?:\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))?/g)];
 if(!tokens.length||!/^\d{2}(?: [A-Z]{3})?(?:(?: TO | AND |, )\d{2}(?: [A-Z]{3})?)*$/.test(spec))return null;
 let month=tokens[0][2]?MONTHS.indexOf(tokens[0][2])+1:MONTHS.indexOf(tokens.findLast(t=>t[2])?.[2])+1,y=year,prior=null,priorEnd=0;const days=[];
 if(!month)return null;
 for(const t of tokens){
  const connector=spec.slice(priorEnd,t.index).trim().replace(',','AND');
  const explicit=t[2]?MONTHS.indexOf(t[2])+1:null;
  if(explicit){if(prior&&explicit<month)y++;month=explicit;}else if(prior&&+t[1]<prior.d){month++;if(month>12){month=1;y++;}}
  const date={y,m:month,d:+t[1]},end=stamp(y,month,date.d);if(end===null)return null;
  if(connector==='TO'){
   const start=stamp(prior.y,prior.m,prior.d);if(end<start||end-start>366*DAY)return null;
   for(let v=start+DAY;v<=end;v+=DAY){const d=new Date(v);days.push({y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate()});}
  }else days.push(date);
  prior=date;priorEnd=t.index+t[0].length;
 }
 return days;
}
const dateRE=/(?:(20\d{2})年)?(?:(\d{1,2})月)?(\d{1,2})日/y;
function dateAt(s,index,year,month,prior){dateRE.lastIndex=index;const m=dateRE.exec(s);if(!m)return null;let y=m[1]?+m[1]:year,mo=m[2]?+m[2]:month;if(prior&&!m[1]&&m[2]&&mo<prior.m)y++;if(!y||!mo||stamp(y,mo,+m[3])===null)return null;return{y,m:mo,d:+m[3],end:dateRE.lastIndex,explicitYear:!!m[1]};}
function datesAt(s,index,year,month){let first=dateAt(s,index,year,month);if(!first)return null;let p=first.end,last=first,days=[first],range=false;
 while(true){if(s[p]==='-'){const end=dateAt(s,p+1,last.y,last.m,last);if(!end)break;const a=stamp(last.y,last.m,last.d),b=stamp(end.y,end.m,end.d);if(b<a||b-a>366*DAY)return null;for(let t=a+DAY;t<=b;t+=DAY){const d=new Date(t);days.push({y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate()});}last=end;p=end.end;range=true;continue;}
 if(/[、,]/.test(s[p]||'!')){const next=dateAt(s,p+1,last.y,last.m,last);if(!next)break;days.push(next);last=next;p=next.end;continue;}break;}
 return{days,first,last,end:p,range};}
const reserveDateRE=/\(\s*予\s*備(?:\s*日)?[^)]*\d{1,2}\s*日[^)]*\)/g;
const pairRE=/^(\d{4})(Z)?-(翌日|次日)?(\d{4})(Z)?/;
function window(day,pair,zone){const offset=pair[2]||pair[5]?0:timeZoneOffsetMinutes(zone);if(offset===null)return null;const start=stamp(day.y,day.m,day.d,pair[1],offset);let end=stamp(day.y,day.m,day.d,pair[4],offset);if(start===null||end===null||pair[1]==='2400')return null;if(pair[3])end+=DAY;else if(end<start)end+=DAY;if(end<=start)return null;return{start,end,timeZone:offset===0?'UTC':zone};}
function parseCandidate(item,{defaultZone=null,zoneEvidence=null}={}){
 const h=heading(item),reasons=[],evidence=[],periods=[],calendarEvidence=[];const english=item.identity.startsWith('NAVAREA')||item.identity.startsWith('NAVTEX-English:');
 // Separate conditional dates before any primary date scan; reserve areas alone are not dates.
 const body=h.body.replace(reserveDateRE,'');
 if(body!==h.body)reasons.push('alternate-dates-require-review');
 const explicitEnglishYear=english?body.match(/\b\d{2}\d{4}Z TO \d{2}\d{4}Z [A-Z]{3} (20\d{2})\b/):null;
 if(explicitEnglishYear&&!h.year){h.year=+explicitEnglishYear[1];h.yearEvidence=explicitEnglishYear[0];h.bodyYear=true;}
 const result=()=>{const unique=[...new Map(periods.map(p=>[p.start+'/'+p.end,p])).values()].sort((a,b)=>a.start-b.start);return{version:1,calendarEvidence,status:unique.length?(reasons.length?'partial':'parsed'):'unknown',periods:unique,reasons:[...new Set(reasons)],evidence,yearBasis:h.year?{year:h.year,kind:h.bodyYear?'explicit-body-year':'source-heading-calendar-context',raw:h.yearEvidence}:null,zoneEvidence,cancellation:{state:'unknown',selfScheduled:[...body.matchAll(/CANCEL THIS MSG ([^.]+)\./g)].map(x=>x[1]),otherReferences:[...body.matchAll(/CANCEL (?!THIS MSG)([^.]+)\./g)].map(x=>x[1])},dateOnlyFallback:unique.some(p=>p.provenance==='user-date-only-fallback')};};
 if(!h.year){reasons.push('year-not-established');return result();}
 if(english){const activity=body.split(/CANCEL THIS MSG/)[0].replace(/\s+/g,' ');if(/ALTERNATE/.test(activity))reasons.push('alternate-dates-require-review');const primary=activity.split(/ALTERNATE/)[0];
  const dtg=primary.match(/\b(\d{2})(\d{4})Z? TO (\d{2})(\d{4})Z? ([A-Z]{3})(?: (20\d{2}))?/);if(dtg&&(dtg[0].includes('Z')||defaultZone)){const month=MONTHS.indexOf(dtg[5])+1,y=dtg[6]?+dtg[6]:h.year,zone=dtg[0].includes('Z')?'UTC':defaultZone,offset=timeZoneOffsetMinutes(zone),start=stamp(y,month,+dtg[1],dtg[2],offset),end=stamp(y,month,+dtg[3],dtg[4],offset);if(start!==null&&end!==null&&end>start){periods.push({start,end,timeZone:zone,provenance:'explicit-body-clock',raw:dtg[0]});evidence.push(dtg[0]);}}
  const daily=primary.match(/\b(\d{4})Z? TO (\d{4})Z? (?:COMMENCING )?DAILY ([A-Z0-9 ,]+?)(?:\.|$)/);if(daily&&(daily[0].includes('Z')||defaultZone)){
   const days=englishDays(daily[3],h.year);
   if(days)for(const day of days){const p=window(day,[null,daily[1],daily[0].includes('Z')?'Z':null,null,daily[2],null],defaultZone);if(p)periods.push({...p,provenance:'explicit-daily-body-clock',raw:daily[0].replace(/\.$/,'')});}
   else reasons.push('unresolved-english-calendar');
   evidence.push(daily[0]);
  }
  if(!periods.length)reasons.push(/UNTIL FURTHER NOTICE/.test(activity)?'open-ended-without-bounded-period':/UNTIL \d{2}/.test(activity)?'start-not-established':/OBSERVED|REPORTED|ISSUED AT/.test(activity)?'observation-or-issue-time-only':'no-bounded-activity-period');
  const pubMonth=headingMonth(h.yearEvidence);
  const firstMonth=dtg?MONTHS.indexOf(dtg[5])+1:daily?englishDays(daily[3],h.year)?.[0]?.m:null;
  if(!dtg?.[6]&&((pubMonth===12&&firstMonth===1)||(pubMonth===1&&firstMonth===12))){periods.length=0;reasons.push('year-boundary-not-established');}
  return result();
 }
 let s=body.replace(/\s+/g,'').replace(/から/g,'-');
 // Different time clauses tied to numbered areas need an explicit geometry mapping.
 const firstArea=s.search(/\(1\)/),hasActivityDate=x=>/\d{1,2}日[^NSEW]{0,60}\d{4}(?:Z)?-/.test(x);
 if(firstArea>=0&&/\(2\)/.test(s)&&hasActivityDate(s.slice(0,firstArea))&&hasActivityDate(s.slice(firstArea))){reasons.push('area-specific-period-mapping-unresolved');return result();}
 if(/\(1\)[^]*\(2\)/.test(s)&&/\(1\)[^]*\d{4}[^]*\(2\)[^]*\d{4}/.test(s)&&/区域|海面|発射|打上|射撃/.test(s.slice(0,100))){const chunks=s.split(/\([123]\)/).slice(1);if(chunks.filter(x=>/\d{1,2}日|\d{4}Z?-\d{4}/.test(x)).length>1){reasons.push('area-specific-period-mapping-unresolved');return result();}}
 const anyClock=/\d{4}Z|\d{4}(?:-|時)|\d{1,2}:\d{2}|\d{1,2}時|午前|午後|日出|日没|日中|夜間/.test(stripTimeZoneLabels(s));
 let cursor=0,month=null,recognized=0;const search=/(?:(?:20\d{2})年)?(?:\d{1,2}月)?\d{1,2}日/g;
 while(cursor<s.length){search.lastIndex=cursor;const found=search.exec(s);if(!found)break;const startIndex=found.index,group=datesAt(s,startIndex,h.year,month);if(!group){cursor=startIndex+found[0].length;continue;}month=group.last.m;let p=group.end,qualifier='',excluded=[],excludeHolidays=false;
  if(s[p]==='('){const end=s.indexOf(')',p);if(end<0){reasons.push('unclosed-calendar-condition');break;}qualifier=s.slice(p,end+1);p=end+1;if(/予備/.test(qualifier))reasons.push('alternate-dates-require-review');if(/祝日/.test(qualifier)){
    if(/地域航行警報:/.test(item.identity)&&defaultZone==='JST'&&/^\((?:日曜日(?:及び|と))?祝日を除く。?\)$/.test(qualifier)&&group.days.every(d=>JP_HOLIDAYS[d.y])){excludeHolidays=true;calendarEvidence.push({kind:'official-japan-holiday-calendar',years:[...new Set(group.days.map(d=>d.y))],url:HOLIDAY_URL,raw:qualifier});}
    else{reasons.push('holiday-calendar-unresolved');cursor=p;continue;}
   }if(/除/.test(qualifier)){if(/土曜日と日曜日/.test(qualifier))excluded=[0,6];else if(/日曜日/.test(qualifier))excluded=[0];else if(!excludeHolidays){reasons.push('calendar-exclusion-unresolved');cursor=p;continue;}}}
  const daily=s.slice(p).match(/^(?:の)?毎日/);if(daily)p+=daily[0].length;else if(s[p]==='の')p++;
  // Explicit endpoint dates/next-day markers have priority over date-only fallback.
  const startClock=s.slice(p).match(/^(\d{4})(Z)?-/);let processed=false;
  if(startClock&&!group.range&&group.days.length===1){const after=p+startClock[0].length,endDay=dateAt(s,after,group.first.y,group.first.m,group.first);if(endDay){const endClock=s.slice(endDay.end).match(/^(\d{4})(Z)?/);if(endClock){const zone=startClock[2]||endClock[2]?'UTC':defaultZone;const offset=timeZoneOffsetMinutes(zone);if(offset===null)reasons.push('time-zone-not-established');else{const a=stamp(group.first.y,group.first.m,group.first.d,startClock[1],offset),b=stamp(endDay.y,endDay.m,endDay.d,endClock[1],offset);if(a!==null&&b!==null&&b>a){periods.push({start:a,end:b,timeZone:zone,provenance:'explicit-body-clock',raw:s.slice(startIndex,endDay.end+endClock[0].length)});recognized++;}else reasons.push('invalid-clock-or-date');}cursor=endDay.end+endClock[0].length;processed=true;}}}
  if(processed)continue;
  const pair=pairRE.exec(s.slice(p));if(pair){
   // A bounded list/range of dates followed by a clock pair is a daily window;
   // a continuous interval instead has clocks on both dated endpoints above.
   let last=p;while(true){const next=pairRE.exec(s.slice(last));if(!next)break;for(const day of group.days){if(excluded.includes(new Date(stamp(day.y,day.m,day.d)).getUTCDay())||excludeHolidays&&JP_HOLIDAYS[day.y].has(day.m+'-'+day.d))continue;const v=window(day,next,defaultZone);if(v)periods.push({...v,provenance:daily?'explicit-daily-body-clock':'explicit-body-clock',raw:s.slice(startIndex,last+next[0].length)});else reasons.push(next[2]||next[5]||defaultZone?'invalid-clock-or-date':'time-zone-not-established');}recognized++;last+=next[0].length;if(/[、,]/.test(s[last]||'!')&&pairRE.test(s.slice(last+1)))last++;else break;}
   evidence.push(s.slice(startIndex,last));cursor=last;continue;
  }
  if(group.range&&!anyClock&&!qualifier&&!daily&&!/当分|追って|予備|除|祝日/.test(s)){const offset=timeZoneOffsetMinutes(defaultZone);if(offset===null)reasons.push('time-zone-not-established');else{periods.push({start:stamp(group.first.y,group.first.m,group.first.d,'0000',offset),end:stamp(group.last.y,group.last.m,group.last.d,'2400',offset),timeZone:defaultZone,provenance:'user-date-only-fallback',label:'日付のみのため終日扱い',raw:s.slice(startIndex,p)});recognized++;}}
  else if(group.range)reasons.push(anyClock?'unparsed-clock-or-scope-prevents-date-fallback':'unresolved-calendar-condition');
  cursor=Math.max(p,startIndex+found[0].length);
 }
 if(/予備日|ALTERNATE/.test(s))reasons.push('alternate-dates-require-review');
 if(!periods.length&&!reasons.length)reasons.push(/当分の間|追って/.test(s)?'open-ended-without-bounded-period':/まで/.test(s)?'start-not-established':'no-bounded-activity-period');
 return result();
}

// These decisions are scoped to the source service and geographical context.
// An explicit body timezone always overrides a reusable source convention.
export function msilTimeZoneBasis(item){return explicitTimeZoneOptions(item)||sourceTimeZoneOptions(item)||{defaultZone:null,zoneEvidence:null};}

// Match literal source vertices to official polygons, independent of ring order.
// API array order is not an area identifier, so never zip areas and shapes.
function sameVertices(a,b){
 const unique=points=>points.filter((p,i)=>!points.slice(0,i).some(q=>Math.abs(p[0]-q[0])<0.00008&&Math.abs(p[1]-q[1])<0.00008));
 const aa=unique(a||[]),bb=unique(b||[]);
 return aa.length>=3&&aa.length===bb.length&&aa.every(p=>bb.some(q=>Math.abs(p[0]-q[0])<0.00008&&Math.abs(p[1]-q[1])<0.00008));
}
function literalVertices(text){
 const r=/(\d{1,2})-(\d{1,2}(?:\.\d+)?)(?:-(\d{1,2}(?:\.\d+)?))?([NS])\s*(\d{1,3})-(\d{1,2}(?:\.\d+)?)(?:-(\d{1,2}(?:\.\d+)?))?([EW])/g;
 const points=[];let first=-1,last=0;
 for(const m of text.matchAll(r)){
  if(+m[1]>90||+m[2]>=60||+(m[3]||0)>=60||+m[5]>180||+m[6]>=60||+(m[7]||0)>=60)return null;
  const lat=(+m[1]+ +m[2]/60+ +(m[3]||0)/3600)*(m[4]==='S'?-1:1),lon=(+m[5]+ +m[6]/60+ +(m[7]||0)/3600)*(m[8]==='W'?-1:1);
  if(Math.abs(lat)>90||Math.abs(lon)>180)return null;
  points.push([lat,lon]);if(first<0)first=m.index;last=m.index+m[0].length;
 }
 return points.length>=3?{points,first,last}:null;
}
function scopedJapanesePeriods(item,options){
 if(!Array.isArray(item.shapes)||!item.shapes.length)return null;
 const h=heading(item),body=h.body,markers=[...body.matchAll(/\((\d+)\)/g)];
 if(!h.year||markers.length<2||new Set(markers.map(m=>m[1])).size!==markers.length)return null;
 const parse=text=>parseCandidate({identity:item.identity,text:`発表日時：${h.year}年${headingMonth(h.yearEvidence)||1}月01日00時\n${text}`},options);
 let current=parse(body.slice(0,markers[0].index));const scopes=[],used=new Set();
 for(let i=0;i<markers.length;i++){
  const marker=markers[i],chunk=body.slice(marker.index+marker[0].length,markers[i+1]?.index??body.length),coords=literalVertices(chunk);
  if(!coords)return null;
  const prefix=chunk.slice(0,coords.first);
  if(/\d{1,2}月\d{1,2}日/.test(prefix))current=parse(prefix);
  if(!current.periods.length||current.reasons.some(r=>r!=='alternate-dates-require-review'))return null;
  const matches=item.shapes.map((shape,index)=>shape.kind==='polygon'&&sameVertices(coords.points,shape.points)?index:-1).filter(index=>index>=0);
  if(matches.length!==1||used.has(matches[0]))return null;
  used.add(matches[0]);scopes.push({areaLabel:marker[1],shapeIndex:matches[0],points:coords.points,periods:current.periods});
  const trailing=chunk.slice(coords.last);if(/\d{1,2}月\d{1,2}日/.test(trailing))current=parse(trailing);
 }
 return used.size===item.shapes.length?scopes:null;
}
export function msilPeriodsForShape(schedule,shape){
 if(schedule.geometryTimeMapping!=='verified-coordinate-match'||!schedule.periods?.length||schedule.cancellation?.state==='cancelled'||shape.kind!=='polygon')return null;
 const scopes=schedule.areaPeriods.filter(scope=>sameVertices(scope.points,shape.points));
 return scopes.length===1?scopes[0].periods:null;
}
// Keep a literally published calendar envelope separate from executable activity.
// A solar clock, holiday or area-time limitation may make activity unreadable,
// but cannot erase independently stated dates. Never derive bounds by combining
// parsed windows, alternate days, issue times, or the extents of area schedules.
function explicitCalendarEnvelope(item,options,result){
 const empty={periods:[],complete:false},h=heading(item);
 if(options.zoneConflict||result.cancellation.state==='cancelled'||result.reasons.some(r=>/cancellation|year-boundary/.test(r)))return empty;
 if(!result.reasons.some(r=>['unparsed-clock-or-scope-prevents-date-fallback','unresolved-calendar-condition','holiday-calendar-unresolved','calendar-exclusion-unresolved','activity-limitation-unresolved','area-specific-period-mapping-unresolved'].includes(r)))return empty;
 const s=h.body.replace(/\s+/g,'').replace(/から/g,'-');
 // These can refer to an earlier notice, observation, or a replaced period.
 // Their dates are not authority for a current activity envelope.
 if(/観測|観察|事故|原警報|旧警報|変更前|原定|延期|延長|変更|当分の間|追って|UNTILFURTHERNOTICE/.test(s))return empty;
 const first=/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/.exec(s);
 if(!first)return empty;
 const prefix=s.slice(0,first.index),firstArea=s.search(/\(\d+\)/);
 // Only an initial, warning-wide range is eligible. A range inside a numbered
 // area or after another activity date is not a global calendar envelope.
 if((firstArea>=0&&firstArea<first.index)||/\d{1,2}日|予備|取消|削除|発表|掲載|公表|公開|配信|発行|刊行|発刊|更新|発布|告示|公告|公示|観測|報告/.test(prefix))return empty;
 const a=dateAt(s,first.index,h.year,null);if(!a)return empty;
 let cursor=a.end;const startClock=/^(\d{4})(Z)?(?=-)/.exec(s.slice(cursor));
 if(startClock)cursor+=startClock[0].length;
 if(s[cursor]!=='-')return empty;
 const b=dateAt(s,cursor+1,a.y,a.m,a);if(!b)return empty;
 cursor=b.end;let endClock=/^(\d{4})(Z)?/.exec(s.slice(cursor));
 // A clock pair after a date range describes each day's activity, not a dated
 // endpoint. Its dates remain coarse bounds, without making those hours active.
 const solarNames=text=>text.replace(/日の入り|日の入|日没|SUNSET/gi,'SUNSET').replace(/日の出|日出|SUNRISE/gi,'SUNRISE');
 const sharedClock=!startClock&&endClock&&/^-(?:翌日|次日)?(?:\d{4}Z?|SUNRISE|SUNSET)/.test(solarNames(s.slice(cursor+endClock[0].length)));
 const attachedClock=solarNames(s.slice(b.end).replace(/^\([^)]*\)/,'').replace(/^(?:の)?毎日/,'')).match(/^(?:\d{4}Z?|SUNRISE|SUNSET)-(?:翌日|次日)?(?:\d{4}Z?|SUNRISE|SUNSET)/);
 const clockZone=startClock?.[2]||endClock?.[2]||attachedClock?.[0].includes('Z');
 if(sharedClock)endClock=null;
 if(endClock)cursor+=endClock[0].length;
 const zone=clockZone?'UTC':options.defaultZone,offset=timeZoneOffsetMinutes(zone);
 if(offset===null)return empty;
 // An omitted January/December activity year is still ambiguous even though
 // both day/month endpoints are present.
 const pubMonth=headingMonth(h.yearEvidence);
 if(!a.explicitYear&&((pubMonth===12&&a.m===1)||(pubMonth===1&&a.m===12)))return empty;
 const start=stamp(a.y,a.m,a.d,startClock?.[1]||'0000',offset),end=stamp(b.y,b.m,b.d,endClock?.[1]||'2400',offset);
 if(start===null||end===null||startClock?.[1]==='2400'||end<=start||end-start>367*DAY)return empty;
 const raw=s.slice(first.index,cursor),rest=s.slice(cursor).replace(/CANCELTHISMSG[^.]*\./g,'');
 // Additional dates/reserve days remain separate unresolved scopes. In those
 // cases this published range can match, but cannot exclude all other dates.
 // Overnight solar/daily wording likewise cannot establish a final midnight.
 let complete=!/\d{1,2}日|予備|ALTERNATE|別の活動|別途|別件|翌日|次日|夜間/i.test(rest);
 const solarRest=solarNames(rest);
 // Unresolved sunset-start and sunrise-end ranges can continue into the next
 // calendar day, including mixed numeric/solar clocks and spelling aliases.
 // The published dates remain useful bounds, but cannot prove inactivity after
 // their final midnight unless that overnight scope is independently resolved.
 if(/SUNSET(?:-|TO)|(?:-|TO|UNTIL)SUNRISE|SUNSET[^。;.]*SUNRISE/i.test(solarRest))complete=false;
 for(const m of rest.matchAll(/(\d{4})Z?-(\d{4})Z?/g))if(+m[2]<+m[1])complete=false;
 return {periods:[{start,end,timeZone:zone,precision:startClock&&endClock?'minute':!startClock&&!endClock?'date':'mixed',startPrecision:startClock?'time':'date',endPrecision:endClock?'time':'date',provenance:'published-calendar-envelope',raw}],complete};
}
export function parseMsilPeriods(item,options=msilTimeZoneBasis(item)){
 options=explicitTimeZoneOptions(item)||options;
 if(options.defaultZone&&(!options.zoneEvidence||timeZoneOffsetMinutes(options.defaultZone)===null))options={defaultZone:null,zoneEvidence:null};
 const result=parseCandidate(item,options),h=heading(item);
 if(options.zoneConflict)result.reasons.push(options.zoneConflict);
 if(result.reasons.includes('area-specific-period-mapping-unresolved')){const scoped=scopedJapanesePeriods(item,options);if(scoped){result.areaPeriods=scoped;result.periods=[...new Map(scoped.flatMap(a=>a.periods).map(p=>[p.start+'/'+p.end,p])).values()].sort((a,b)=>a.start-b.start);result.reasons=result.reasons.filter(r=>r!=='area-specific-period-mapping-unresolved');}}
 let residual=h.body.replace(reserveDateRE,'').split(/ALTERNATE/)[0].replace(/\s+/g,'').replace(/から/g,'-');
 for(const p of [...result.periods].sort((a,b)=>(b.raw?.length||0)-(a.raw?.length||0)))if(p.raw)residual=residual.replaceAll(p.raw.replace(/\s+/g,''),'');
 // A successful clause is not proof that every other activity clause was read.
 residual=residual.replace(/CANCEL THIS MSG[^.]*\./g,'').replace(/CANCEL (?!THIS MSG)[^.]*\./g,'');
 if(result.periods.length&&(/\d{1,2}月\d{1,2}日|\d{4}Z?(?:-|TO)\d{4}/.test(residual)))result.reasons.push('remaining-activity-time-needs-review');
 if(/ALTERNATE/.test(h.body)&&result.cancellation.selfScheduled.length)result.reasons.push('alternate-and-self-cancellation-require-review');
 const alternateMatches=[...h.body.matchAll(/ALTERNATE[^.]+/g),...h.body.matchAll(reserveDateRE)].sort((a,b)=>a.index-b.index);
 result.alternateEvidence=alternateMatches.map(m=>m[0]);
 result.cancellation.otherReferences.push(...[...h.body.matchAll(/[（(][^（）()]*削除[^（）()]*[）)]/g)].map(m=>m[0]));
 result.openEndedEvidence=/当分の間|UNTIL FURTHER NOTICE/.test(h.body)?h.body.match(/[^\n]*(?:当分の間|UNTIL FURTHER NOTICE)[^\n]*/g):[];
 result.openEndedPeriods=[];
 const open=h.body.replace(/\s+/g,'').match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日(\d{4})(Z)?-当分の間/);
 if(open&&h.year&&!result.reasons.includes('area-specific-period-mapping-unresolved')){
  const offset=open[5]?0:timeZoneOffsetMinutes(options.defaultZone);
  const start=offset===null?null:stamp(open[1]?+open[1]:h.year,+open[2],+open[3],open[4],offset);
  if(start!==null)result.openEndedPeriods.push({start,end:null,precision:'minute',timeZone:offset===0?'UTC':options.defaultZone,raw:open[0],provenance:'explicit-open-ended-body-clock'});
 }
 result.alternatePeriods=[];
 for(const match of alternateMatches){
  const raw=match[0],sourceOffset=match.index;
  const compactRaw=raw.replace(/\s+/g,'');
  // Explicit clocks within a reserve clause belong only to conditional periods.
  if(/予備/.test(compactRaw)&&/\d{4}Z?-/.test(compactRaw)){
   const prefix=h.body.slice(0,sourceOffset),months=[...prefix.matchAll(/(\d{1,2})月/g)];
   const month=months.at(-1)?.[1],inner=compactRaw.replace(/^\(予備(?:日)?/,'').replace(/\)$/,'');
   if(month&&h.year){const parsed=parseCandidate({identity:item.identity,text:`発表日時：${h.year}年10月02日08時\n${month}月${inner}`},options);for(const p of parsed.periods)result.alternatePeriods.push({...p,conditional:true,raw,sourceOffset});}
   continue;
  }
  if(raw.startsWith('ALTERNATE')){
   const text=`NO.00-0000 Date:${h.year}/${String(headingMonth(h.yearEvidence)||1).padStart(2,'0')}/01 00 UTC\n${raw.replace(/^ALTERNATE\s*/,'')}`;
   const parsed=parseCandidate({identity:'NAVTEX-English:alternate',text},options);for(const p of parsed.periods)result.alternatePeriods.push({...p,conditional:true,raw,sourceOffset});continue;
  }
  if(!raw.startsWith('('))continue;
  const prefix=h.body.slice(0,sourceOffset).replace(/\s+/g,''),months=[...prefix.matchAll(/(\d{1,2})月/g)];
  const days=datesAt(compactRaw.replace(/^\(予備(?:日)?/,'').replace(/\)$/,''),0,h.year,months.length?+months.at(-1)[1]:null);
  const tail=h.body.slice(sourceOffset+raw.length).replace(/\s+/g,'').replace(/^(?:の)?(?:毎日)?/,'').replace(/から/g,'-');
  const pair=pairRE.exec(tail);
  if(days&&pair)for(const day of days.days){const p=window(day,pair,options.defaultZone);if(p)result.alternatePeriods.push({...p,conditional:true,raw,sourceOffset});}
 }
 if(options.sourceDiscrepancies?.length){result.sourceDiscrepancies=options.sourceDiscrepancies;result.reasons.push('source-alternate-calendar-conflict');}
 result.reasons=[...new Set(result.reasons)];
 result.status=result.periods.length?(result.reasons.length?'partial':'parsed'):'unknown';
 result.completeness=result.status==='parsed'?'complete':result.status;
 if(result.openEndedPeriods.length)result.completeness='open-ended';
 result.precision=result.periods.length?(result.dateOnlyFallback?'date':'minute'):result.openEndedPeriods.length?'minute':'unknown';
 result.geometryTimeMapping=result.areaPeriods?'verified-coordinate-match':result.reasons.includes('area-specific-period-mapping-unresolved')?'unresolved':'warning-wide';
 const publicationMonth=headingMonth(h.yearEvidence),firstDate=h.body.match(/(?:(20\d{2})年)?(\d{1,2})月\d{1,2}日/);
 if(firstDate&&!firstDate[1]&&((publicationMonth===12&&+firstDate[2]===1)||(publicationMonth===1&&+firstDate[2]===12))){result.unappliedPeriods=result.periods;result.periods=[];result.openEndedPeriods=[];result.reasons.push('year-boundary-not-established');result.status='unknown';result.completeness='unknown';}
 let exclusions=h.body.replace(/\s+/g,'').replace(/\((?:土曜日と日曜日|日曜日)を除く。?\)/g,'');
 for(const e of result.calendarEvidence)exclusions=exclusions.replaceAll(e.raw,'');
 if(/除く|除き|除外|\bEXCEPT\b|\bEXCLUDING\b/.test(exclusions)){
  result.unappliedPeriods=result.periods;result.periods=[];result.openEndedPeriods=[];result.reasons.push('calendar-exclusion-unresolved');result.status='unknown';result.completeness='unknown';
 }
 // An unresolved limitation invalidates the broad candidate, even if its clocks parsed.
 const limitationScope=h.body.replace(/(?:^|[。\n])別の活動\d{1,2}月\d{1,2}日[^。\n]*/g,'');
 let unconsumedScope=limitationScope.replace(reserveDateRE,'').split(/ALTERNATE|CANCEL THIS MSG/)[0].replace(/\s+/g,'').replace(/から/g,'-');
 for(const p of [...result.periods].sort((a,b)=>(b.raw?.length||0)-(a.raw?.length||0)))if(p.raw)unconsumedScope=unconsumedScope.replaceAll(p.raw.replace(/\s+/g,''),'');
 if(/ただし|但し|のみ|日没|日出|日の出|日の入り|日中|夜間|\b(?:ONLY|UNTIL SUNSET|SUNRISE|SUNSET)\b/i.test(limitationScope)||/\d{4}Z?まで|\d{4}Z?(?:-|TO)(?:翌日)?\d{4}/.test(unconsumedScope)){
  result.unappliedPeriods=[...(result.unappliedPeriods||[]),...result.periods];result.periods=[];result.openEndedPeriods=[];result.reasons.push('activity-limitation-unresolved');result.status='unknown';result.completeness='unknown';
 }
 const selfClauses=h.body.split(/[。\n]/).map(x=>x.trim()).filter(x=>/(?:本警報|この警報)(?:は|を)?(?:取消|取り消|削除)/.test(x));
 const affirmative=x=>/^(?:本警報|この警報)(?:は|を)?(?:取消(?:し)?(?:済み|しました|します)?|取り消(?:しました|します)|削除(?:済み|しました|します)?)(?:です)?$/.test(x);
 if(selfClauses.length&&selfClauses.every(affirmative)){result.cancellation.state='cancelled';result.cancellation.selfEvidence=selfClauses;result.periods=[];result.openEndedPeriods=[];}
 else if(selfClauses.some(affirmative)){result.reasons.push('self-cancellation-conflict');result.unappliedPeriods=result.periods;result.periods=[];result.openEndedPeriods=[];result.status='unknown';result.completeness='unknown';}
 else if(/(?:射撃|訓練|活動).{0,12}(?:中止|取消|取り消)/.test(h.body)){result.reasons.push('activity-cancellation-needs-review');result.periods=[];result.openEndedPeriods=[];result.status='unknown';result.completeness='unknown';}
 // A later restriction or cancellation invalidates the scoped activity too.
 // Retain rejected evidence separately; it must never reach shape validity.
 if(result.areaPeriods&&(!result.periods.length||result.cancellation.state==='cancelled')){
  result.unappliedAreaPeriods=result.areaPeriods;delete result.areaPeriods;result.geometryTimeMapping='unresolved';result.precision='unknown';
 }
 if(options.zoneConflict){
  result.unappliedPeriods=result.periods;result.periods=[];result.openEndedPeriods=[];result.alternatePeriods=[];
  if(result.areaPeriods){result.unappliedAreaPeriods=result.areaPeriods;delete result.areaPeriods;result.geometryTimeMapping='unresolved';}
  result.status='unknown';result.completeness='unknown';result.precision='unknown';
 }
 const sourceSchedule=msilSourceSchedule(item);if(sourceSchedule)result.sourceSchedule=sourceSchedule;
 const envelope=explicitCalendarEnvelope(item,options,result);
 if(envelope.periods.length){result.validityPeriods=envelope.periods;result.validityComplete=envelope.complete;}
 return result;
}
