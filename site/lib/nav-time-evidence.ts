/** Maritime-only presentation evidence. Never use these facts as active intervals. */
export type MaritimeTimeFact = {
  kind: 'reported-time' | 'reported-date';
  raw: string;
  /** Date-only bounds locate the calendar day, not continuous activity. */
  dateStart: number;
  dateEnd: number;
  instant: number | null;
  timezone: 'UTC+8';
  label: string;
  warning?: string;
};
type EvidenceNotice = { sourceCountry?: string; text: string; issued: number | null; cancelled?: boolean };
const DAY = 86400000, HOUR = 3600000;
export function chinaMaritimeTimeFacts(item: EvidenceNotice): MaritimeTimeFact[] {
  if (item.sourceCountry !== 'CN' || item.cancelled) return [];
  const source = item.text.normalize('NFKC').replace(/[ \t\u00a0]+/g,' ');
  // Only dated operational sentences. Standalone signature/publication dates and
  // references to other notices are not activity evidence.
  const clauses = source.split(/[。；;\n]/).filter(s => /航警|作业时间|施工时间|管制时间|活动时间|计划运行时刻|于[^。]*实施|自[^。]*起/.test(s));
  const facts: MaritimeTimeFact[] = [];
  for (const original of clauses) {
    if (/撤销|撤銷|恢复正常|恢復正常|解除管制|延期至|延长至|延長至/.test(original)) continue;
    const text=original.replace(/\s+/g,'');
    // Deliberately do not infer a missing month, a missing year without issue
    // metadata, or repair invalid clock/date values.
    const regex=/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日(?:(\d{1,4})(?:时(?:(\d{1,2})分?)?|:(\d{2})(?:时)?))?/g;
    for (const m of text.matchAll(regex)) {
      if (/^\d/.test(text.slice(m.index!+m[0].length))) continue;
      let y=m[1]?+m[1]:null;
      if(y===null && item.issued!==null && Number.isFinite(item.issued)) {
        const issued=new Date(item.issued+8*HOUR), pm=issued.getUTCMonth()+1;
        y=issued.getUTCFullYear()+(pm===12&&+m[2]===1?1:pm===1&&+m[2]===12?-1:0);
      }
      if(y===null) continue;
      const date=Date.UTC(y,+m[2]-1,+m[3]), check=new Date(date);
      if(check.getUTCFullYear()!==y||check.getUTCMonth()!==+m[2]-1||check.getUTCDate()!==+m[3])continue;
      let instant:number|null=null;
      if(m[4]) {
        let h:number, min:number;
        if(m[5]!==undefined||m[6]!==undefined){h=+m[4];min=+(m[5]||m[6]);}
        else if(m[4].length<=2){h=+m[4];min=0;}else{h=Math.floor(+m[4]/100);min=+m[4]%100;}
        if(h>24||min>59||(h===24&&min!==0))continue;
        instant=date-8*HOUR+(h*60+min)*60000;
      }
      facts.push({kind:instant===null?'reported-date':'reported-time',raw:m[0],dateStart:date-8*HOUR,dateEnd:date-8*HOUR+DAY,instant,timezone:'UTC+8',label:instant===null?'日付は記載あり・実施時刻は未確定':'日時は記載あり・活動期間は未確定',...(m[1] && item.issued!==null && y!==new Date(item.issued+8*HOUR).getUTCFullYear()?{warning:'本文の年と掲載年が異なります。原文の年を保存しています。'}:{})});
    }
  }
  return [...new Map(facts.map(f=>[`${f.dateStart}/${f.instant}`,f])).values()];
}
/** Explicit activity dates, suitable for calendar filtering, never clock-active claims. */
export function chinaMaritimeCalendarValidity(item: EvidenceNotice): { start: number; end: number; precision: 'date'; label: string; raw: string; warning?: string }[] {
  if(item.sourceCountry!=='CN'||item.cancelled)return [];
  const result:ReturnType<typeof chinaMaritimeCalendarValidity>=[];
  for(const sentence of item.text.split(/[。；;\n]/)){
    const compact=sentence.normalize('NFKC').replace(/\s+/g,'');
    // A stated dated activity, without an explicit clock, open end, daily clock,
    // date range, report-of-incident date, or notice lifecycle date.
    if(!/射击|射擊|训练|訓練|演习|演習|作业时间|施工时间|活动时间|管制时间/.test(compact))continue;
    if(/拖带|拖帶|拖航|离港|離港|起航|开航|開航|发航|發航|出港/.test(compact))continue;
    if(/上午|下午|早晨|白天|夜间|夜間|晚上|日出|日落|凌晨|中午|傍晚|据报|落水|失踪|沉没|撤销|撤銷|恢复|恢復|自\d|日起|另行|延期|延长|延長|每日|每天|每周|每星期|\d(?:时|時|分|:\d)|\d日[^，,]*[至~～]/.test(compact))continue;
    const matches=[...compact.matchAll(/(?:(20\d{2})年)?\d{1,2}月\d{1,2}日/g)];
    if(matches.length!==1)continue;
    const head=matches[0][0], tail=compact.slice(matches[0].index!+head.length);
    const listed=tail.match(/^((?:[、,，和及]\d{1,2}日)+)/)?.[1]||'';
    const monthPrefix=head.slice(0,head.lastIndexOf('月')+1);
    const dateTexts=[head,...[...listed.matchAll(/(\d{1,2})日/g)].map(m=>`${monthPrefix}${m[1]}日`)];
    const facts=dateTexts.flatMap(date=>chinaMaritimeTimeFacts({...item,text:`活动时间：${date}`}));
    for(const f of facts)if(f.instant===null)result.push({start:f.dateStart,end:f.dateEnd,precision:'date',label:'日付のみ・実施時刻記載なし',raw:f.raw,...(f.warning?{warning:f.warning}:{})});
  }
  return [...new Map(result.map(p=>[p.start,p])).values()];
}
