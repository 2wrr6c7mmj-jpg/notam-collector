/** Bounded, evidence-linked interpretations of complete NOTAM E-field families.
 * This module never substitutes Q-line geometry for the stated area, never infers
 * flight prohibition from an activity advisory, and never silently drops a tail.
 * Input is the entire E body (multipart assembly belongs to the caller).
 */
export type SemanticEvidence = { start:number; end:number; original:string; explanation:string; scope?:string };
export type SemanticResidual = { start:number; end:number; original:string; reason:string };
export type SemanticBlock = { id:string; title:string; scope?:string; original:string; start:number; end:number; explanations:string[]; evidence:SemanticEvidence[]; status:'explained'|'partial'|'unresolved'; residuals:SemanticResidual[] };
export type SemanticInterpretation = { family:string; blocks:SemanticBlock[]; status:'explained'|'partial'|'unresolved'; warnings:string[] };
const NUM='\\d+(?:\\.\\d+)?';
const COORD='\\d{6}(?:\\.\\d+)?[NS]\\s*\\d{7}(?:\\.\\d+)?[EW]';
const COORDS=`${COORD}(?:\\s*[-,]?\\s*${COORD})*`;
const AREA_END='(?=\\s*(?:$|[A-Z(]|\\d+\\.\\s+(?:WI|AREA)|\\d+\\s*(?:M|FT)\\s*(?:AMSL|MSL|AGL)))';
const DIST=`${NUM}\\s*(?:NM|KM|M)`;
const ALT=`(?:SFC|GND|UNL|FL\\s*\\d{2,3}|${NUM}\\s*(?:FT|M)\\s*(?:AMSL|MSL|AGL))`;
const numbered='(?:(?:\\(\\d+\\)|\\d+\\.)\\s*)?';
const wordEnd='(?=\\s|[.,;:]|$)';
const typeNames:Record<string,string>={'POWER LINE TOWER':'送電鉄塔','WIND TURBINE':'風力タービン','CHIMNEY':'煙突','TOWER':'塔','BUILDING':'建物','BRIDGE':'橋','CRANE':'クレーン','TOWER CRANE':'タワークレーン','POWER LINE':'送電線','BLDG':'建物','POLE':'柱・支柱','BUDDHA':'仏像'};
function rex(s:string){return new RegExp('^(?:'+s+')','i');}
function clean(s:string){return s.replace(/\s+/g,' ').trim();}
function distance(s:string){return clean(s).replace(/\s*NM$/i,'海里').replace(/\s*KM$/i,'km').replace(/\s*M$/i,'m');}
export function semanticAltitude(s:string):string|null {
 const t=clean(s).toUpperCase(); if(t==='SFC'||t==='GND')return '地表・水面';if(t==='UNL')return '上限なし';
 let m=t.match(/^FL\s*(\d{2,3})$/);if(m)return `FL${m[1]}（標準気圧面によるフライトレベル）`;
 m=t.match(/^(\d+(?:\.\d+)?)\s*(FT|M)\s*(AMSL|MSL|AGL)$/);return m?`${m[1]}${m[2]==='FT'?'フィート':'m'}（${m[3].toUpperCase()==='AGL'?'対地高度':'平均海面基準'}）`:null;
}
function altitudeRange(a:string,b:string){return clean(a)===clean(b)?`${semanticAltitude(a)}の高度`:`${semanticAltitude(a)}から${semanticAltitude(b)}まで`;}
function clockTime(s:string){return s.slice(0,2)+':'+s.slice(2);}
function validClock(s:string){return /^\d{4}$/.test(s)&&+s.slice(0,2)<24&&+s.slice(2)<60;}
/** Normalize only whitespace; every normalized character remains source-addressable. */
class Reader {
 text=''; starts:number[]=[]; ends:number[]=[]; at=0; evidence:SemanticEvidence[]=[]; warnings:string[]=[];
 constructor(readonly original:string){const omitted=new Set<number>();for(const m of original.matchAll(/(\d{1,6})([ \t]*\r?\n[ \t]*)(\d{1,6}(?:\.\d+)?)([NSEW])/g)){const total=m[1].length+m[3].split('.')[0].length;if(total===(/[NS]/.test(m[4])?6:7)){const a=m.index!+m[1].length;for(let j=a;j<a+m[2].length;j++)omitted.add(j);}}let ws=false;for(let i=0;i<original.length;i++){if(omitted.has(i))continue;if(/\s/.test(original[i])){if(!ws){this.text+=' ';this.starts.push(i);this.ends.push(i+1);}else this.ends[this.ends.length-1]=i+1;ws=true;}else{this.text+=original[i];this.starts.push(i);this.ends.push(i+1);ws=false;}}this.whitespace();}
 whitespace(){while(this.text[this.at]===' ')this.at++;}
 rest(){return this.text.slice(this.at);}
 take(pattern:string, render:(m:RegExpMatchArray)=>string, scope?:string, validate?:(m:RegExpMatchArray)=>boolean){this.whitespace();const m=this.rest().match(rex(pattern));if(!m||validate&&!validate(m))return false;const begin=this.at;this.at+=m[0].length;this.evidence.push({start:this.starts[begin]??0,end:this.ends[this.at-1]??0,original:this.original.slice(this.starts[begin]??0,this.ends[this.at-1]??0),explanation:render(m),...(scope?{scope}:{})});this.whitespace();return true;}
 syntax(pattern:string){this.whitespace();const m=this.rest().match(rex(pattern));if(!m)return false;this.at+=m[0].length;this.whitespace();return true;}
 done(){return !this.rest().trim();}
 result(family:string,title:string):SemanticInterpretation {
  const residuals:SemanticResidual[]=this.done()&&this.evidence.length?[]:[{start:this.starts[this.at]??0,end:this.original.length,original:this.original.slice(this.starts[this.at]??0),reason:'この部分を含む条件・係り受けの全体は未解釈です。'}];
  const status=residuals.length?(this.evidence.length?'partial':'unresolved'):'explained';
  const scopeUnresolved=residuals.some(r=>/\b(?:EXC|EXCL|EXCEPT|EXCLUD\w*|NOT AFFECT(?:ED)?|ONLY|UNLESS|NOT APPLICABLE|SUBJECT TO)\b/i.test(r.original));
  if(scopeUnresolved) {
    this.warnings.push('対象を限定する条件や除外の記載が未解析です。以下は読み取れた部分の説明で、区域全体・すべての航空機に適用すると判断しないでください。');
    for(const e of this.evidence) if(e.explanation==='以下に記載された空域が閉鎖されます。') e.explanation='空域の閉鎖に関する記載です。対象となる航空機や例外は、続く原文の確認が必要です。';
    for(const r of residuals) if(/\b(?:EXC|EXCL|EXCEPT|EXCLUD\w*|NOT AFFECT(?:ED)?|ONLY|UNLESS)\b/i.test(r.original)) r.reason='除外・対象限定を含む条件が未解析です。読み取れた区域や活動に、そのまま適用することはできません。';
  }
  const block:SemanticBlock={id:family,title,original:this.original,start:0,end:this.original.length,explanations:this.evidence.map(e=>e.explanation),evidence:this.evidence,status,residuals};
  return {family,blocks:[block],status,warnings:this.warnings};
 }
}
function coordsValid(s:string){const cs=[...s.matchAll(new RegExp(COORD,'gi'))];return cs.length>0&&cs.every(m=>{const a=m[0].match(/^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)[NS]\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)[EW]$/i)!;return +a[1]<=90&&+a[2]<60&&+a[3]<60&&+a[4]<=180&&+a[5]<60&&+a[6]<60&&!(+a[1]===90&&(+a[2]||+a[3]))&&!(+a[4]===180&&(+a[5]||+a[6]));});}
function coordinateKey(s:string){return s.replace(/\s/g,'').replace(/(\d+(?:\.\d+)?)([NSEW])/gi,(_,value,hemisphere)=>`${Number(value)}${hemisphere.toUpperCase()}`);}
function distinctCoords(s:string){return new Set([...s.matchAll(new RegExp(COORD,'gi'))].map(m=>coordinateKey(m[0]))).size;}
function coordsList(s:string){return [...s.matchAll(new RegExp(COORD,'gi'))].map(m=>clean(m[0])).join(' → ');}
function area(r:Reader,scope:string){
 if(r.take(`WI\\s+AREA\\s*:\\s*(${COORDS})[.,]?${AREA_END}`,m=>`${scope}：次の点を原文の順に結び、始点へ戻る境界内：${coordsList(m[1])}。`,scope,m=>{const points=[...m[1].matchAll(new RegExp(COORD,'gi'))].map(x=>coordinateKey(x[0]));return coordsValid(m[1])&&distinctCoords(m[1])>=3&&points[0]===points.at(-1);}))return true;
 const pre='(?:(?:AREA|AIRSPACE|PLACE)(?: AS FLW)?\\s*:?\\s*)?';
 if(r.take(pre+`(?:WI\\s+)?(?:A\\s+)?(?:CIRCLE\\s+)?RADIUS\\s+(${DIST})\\s+CENT(?:ER(?:ED)?|RE|RED)(?:\\s+ON)?\\s+(${COORD})[.,]?`,m=>`${scope}：${clean(m[2])}を中心とする半径${distance(m[1])}の円内。`,scope,m=>coordsValid(m[2])&&parseFloat(m[1])>0))return true;
 if(r.take(pre+`(?:WI\\s+)?(${DIST})\\s+RADIUS\\s+CENT(?:ER(?:ED)?|RE|RED)(?:\\s+ON)?\\s+(${COORD})[.,]?`,m=>`${scope}：${clean(m[2])}を中心とする半径${distance(m[1])}の円内。`,scope,m=>coordsValid(m[2])&&parseFloat(m[1])>0))return true;
 if(r.take(pre+`(?:WI\\s+)?(${DIST})\\s+EITHER SIDE OF (?:A )?LINE(?: JOINING(?: POINTS)?)?\\s*:?\\s*(${COORDS})[.,]?${AREA_END}`,m=>`${scope}：次の点を結ぶ線の左右それぞれ${distance(m[1])}以内（全幅${distance(String(+m[1].match(rex(NUM))![0]*2)+m[1].replace(rex(NUM),''))}）：${coordsList(m[2])}。`,scope,m=>coordsValid(m[2])&&distinctCoords(m[2])>=2&&parseFloat(m[1])>0))return true;
 if(r.take(`(?:${pre})?(?:BOUNDED BY (?:FLW POINTS|THE FOLLOWING)|AS FLW)\\s*:?\\s*(${COORDS})(?:\\s+TO (?:THE )?(?:POINT OF ORIGIN|BEGINNING))?[.,]?${AREA_END}`,m=>`${scope}：次の点を原文の順に結ぶ境界で囲まれた区域：${coordsList(m[1])}。`,scope,m=>coordsValid(m[1])&&distinctCoords(m[1])>=3))return true;
 return false;
}
const safeName=(s:string)=>! /\b(?:EXC|EXCL|EXCEPT|EXCLUD\w*|ONLY|UNLESS|NOT|WITHOUT|MUST|SHALL|PROHIBITED|CLSD|CLOSED|REQUIRED|RESTRICTIONS?|SUBJECT TO|APPROVAL|PERMISSION|PPR|PRIOR|ACFT|FLT|FLIGHT|TFC)\b/i.test(s);
function place(r:Reader,scope?:string){return r.take('\\(([A-Z][A-Z0-9 ,./-]*?)\\)\\.?',m=>`場所の名称（原文）：${m[1]}。`,scope,m=>safeName(m[1]));}
function range(r:Reader,scope:string){return r.take(`(${ALT})\\s*-\\s*(${ALT})[.,]?`,m=>`${scope}の高度範囲：${altitudeRange(m[1],m[2])}。`,scope);}
function flightTime(r:Reader){
 const ok=r.take('FLT TIME\\s*:\\s*(HJ|HN|(?:\\d{4}|SR)/(?:\\d{4}|SS))\\.?',m=>{
  const v=m[1].toUpperCase();if(v==='HJ')return '飛行時間は日の出から日没まで。D欄の時間帯に加え、この条件が適用されます。';if(v==='HN')return '飛行時間は日没から日の出まで。D欄の時間帯に加え、この条件が適用されます。';
  const[a,b]=v.split('/');return `飛行時間は${a==='SR'?'日の出':clockTime(a)+' UTC'}から${b==='SS'?'日没':clockTime(b)+' UTC'}まで。D欄の時間帯に加え、この条件が適用されます。`;
 },undefined,m=>['HJ','HN'].includes(m[1].toUpperCase())||m[1].split('/').every(s=>['SR','SS'].includes(s.toUpperCase())||validClock(s)));
 if(ok)r.warnings.push('E欄に飛行時間の追加条件があります。D欄だけの判定では活動中と確定できません。');return ok;
}
function metadata(r:Reader,scope?:string){
 return r.take(`WT\\s*:\\s*(${NUM})\\s*(KG|G)\\.?`,m=>`機体の重量：${m[1]}${m[2].toUpperCase()==='KG'?'kg':'g'}。`,scope)
 ||r.take('NUMBER\\s*:\\s*(\\d+)\\.?',m=>`機数：${m[1]}機。`,scope)
 ||flightTime(r)
 ||r.take('CONTACT INFORMATION\\s*:\\s*([+0-9 ()/,-]+)'+wordEnd,m=>`連絡先：${m[1].trim()}。`,scope);
}
function obstacle(r:Reader):SemanticInterpretation|null {
 if(!r.take('OBST (LGT U/S|DAY MARKING ERASED)\\.?',m=>m[1].toUpperCase()==='LGT U/S'?'以下の障害物の航空障害灯が使用不能です。':'以下の障害物の昼間障害標識が消失しています。'))return null;
 let count=0;
 while(!r.done()){
  const scope=`障害物${++count}`;
  if(r.take(numbered+`TYPE\\s*:\\s*([A-Z -]+?)\\s+PSN\\s*:\\s*(${COORD})\\s+ELEV\\s*:\\s*(${ALT})[.,]?`,m=>`${scope}：${typeNames[clean(m[1]).toUpperCase()]??clean(m[1])}。位置：${clean(m[2])}。記載された標高：${semanticAltitude(m[3])}。`,scope,m=>coordsValid(m[2])&&!!typeNames[clean(m[1]).toUpperCase()])) {place(r,scope);continue;}
  if(r.take('(?:RMK\\s*:\\s*)?OBST LGT IN PLACE OF OBST DAY MARKING FOR ([A-Z -]+?)\\.?$',m=>`${typeNames[clean(m[1]).toUpperCase()]??clean(m[1])}の昼間障害標識に代えて航空障害灯を用いています。`))continue;
  break;
 }
 return r.result('obstacle','障害物の灯火・標識');
}
function japaneseDrone(r:Reader):SemanticInterpretation|null {
 if(!r.take('(BEYOND VISUAL LINE OF SIGHT )?UNMANNED ACFT(?:\\((FIXED WING)\\))?\\s*:',m=>`${m[2]?'固定翼の':''}無人航空機の${m[1]?'目視外':''}飛行に関する通知です。`))return null;
 let count=0;
 while(!r.done()){
  const before=r.at; const label=r.rest().match(rex('(\\(\\d+\\))\\s*(?=(?:AREA|PLACE))'));if(label)r.syntax('\\(\\d+\\)');
  if(area(r,`区域${count+1}`)){count++;continue;}r.at=before;
  if(place(r)||metadata(r)||r.take('RMK\\s*:\\s*THIS AREA IS INCLUDED IN ([A-Z0-9, -]+)\\.?$',m=>`この区域は${clean(m[1])}に含まれます。`,undefined,m=>safeName(m[1])))continue;
  break;
 }
 return r.result('japanese-uav','無人航空機の飛行');
}
function airspace(r:Reader):SemanticInterpretation|null {
 const tempo=r.take('TEMPO (RESTRICTED|DANGER|PROHIBITED) AREA ACT AS FLW\\s*:?\\s*',m=>`次の一時的な${m[1].toUpperCase()==='RESTRICTED'?'制限':m[1].toUpperCase()==='DANGER'?'危険':'飛行禁止'}区域が有効になります。`);
 const closed=!tempo&&r.take('AIRSPACE CLSD(?: AS FLW\\s*:)?\\s*',()=> '以下に記載された空域が閉鎖されます。');
 if(!tempo&&!closed)return null;
 let count=0;
 while(!r.done()){
  const before=r.at;const label=r.rest().match(rex('(\\d+)\\.\\s*(?=(?:WI|AREA|AIRSPACE|A CIRCLE|CIRCLE))'));if(label)r.syntax('\\d+\\.');
  const scope=label?`区域${label[1]}`:`区域${count+1}`;
  if(area(r,scope)){count++;range(r,scope);continue;}r.at=before;
  if(r.take('RMK\\s*:\\s*THIS AREA IS ESTABLISHED FOR DRONE FLIGHT\\.?',()=> 'この区域はドローン飛行のために設定されています。'))continue;
  break;
 }
 return r.result('airspace','空域の有効化・閉鎖');
}
function military(r:Reader):SemanticInterpretation|null {
 if(!r.take('MULTIPLE U\\.S\\. MIL ACT WILL BE CONDUCTED WI FUKUOKA FIR AS FLW[,:]?',()=> '福岡FIR内の以下の区域で、米軍による複数の活動が行われます。'))return null;
 if(!area(r,'活動区域'))return r.result('us-military','米軍活動と通過制限');
 r.take(`THE LINE CONNECTING (${COORD}) TO (${COORD}) IS THE MINOR ARC WITH A RADIUS OF (${DIST}) FM (${COORD})\\.`,m=>`境界の${clean(m[1])}から${clean(m[2])}までは直線ではなく、${clean(m[4])}を中心とする半径${distance(m[3])}の小弧（短い方の円弧）です。`,'活動区域',m=>coordsValid(m[1])&&coordsValid(m[2])&&coordsValid(m[4]));
 r.take('ATC WILL NOT CLEAR NON-PARTICIPATING IFR FLT THRU THIS AREA\\.',()=> '航空管制は、この活動に参加しないIFR（計器飛行方式）の航空機に、この区域を通過する許可を出しません。');
 r.take('RMK\\s*:\\s*MISSION NAME\\s*:?\\s*([A-Z0-9 -]+)\\.?$',m=>`任務名：${clean(m[1])}。`);
 return r.result('us-military','米軍活動と通過制限');
}
function usDrone(r:Reader):SemanticInterpretation|null {
 if(!r.take('USE CAUTION\\s*:\\s*UNMANNED AERIAL ROTARY DRONE AIRCRAFT OPERATING AT\\s*',()=> '回転翼の無人航空機が運航するため、注意が求められています。'))return null;
 // Decimal coordinate list is deliberately not repaired when separators or digits are corrupt.
 const dec='-?\\d{1,3}\\.\\d+';const pair=`${dec}\\s+${dec}`;
 r.take(`(${pair}(?:[ ,]+${pair})*)(?:\\s*E)?\\s+WITHIN LOCAL KADENA AIRSPACE\\.`,m=>`嘉手納のローカル空域内の次の座標で運航：${clean(m[1])}。`,'運航位置',m=>{const nums=m[1].match(/-?\d+(?:\.\d+)?/g)!.map(Number);return nums.every((v,i)=>Math.abs(v)<=(i%2?180:90))&&nums.every((v,i)=>Math.abs(v-nums[i%2])<=2);});
 r.take(`MAX ALT\\s+(${NUM})\\s*FT(?:/(${NUM})M)?[ /]*(MSL|AMSL|AGL)\\.`,m=>`最高高度：${m[1]}フィート${m[2]?`（併記値${m[2]}m）`:''}、${m[3].toUpperCase()==='AGL'?'対地高度':'平均海面基準'}。`);
 r.take('(\\d+(?:-\\d+)?) FLIGHTS/(\\d+(?:-\\d+)?) MIN EACH\\.?$',m=>`${m[1].replace('-','〜')}回の飛行、1回当たり${m[2].replace('-','〜')}分です。日ごとの回数か期間内の総回数かは本文に指定されていません。`);
 return r.result('us-drone','回転翼ドローンの運航');
}
function taiwan(r:Reader):SemanticInterpretation|null {
 if(!r.take('(UNMANNED FREE BALLOONS|UNMANNED ACFT|GUN FRNG|AIR EXER) WILL (BE LAUNCHED|BE RELEASED|TAKE PLACE)\\s*:',m=>({'UNMANNED FREE BALLOONS':'無人の自由気球が放球されます。','UNMANNED ACFT':'無人航空機が飛行します。','GUN FRNG':'砲・銃による射撃が行われます。','AIR EXER':'航空演習が行われます。'}[m[1].toUpperCase()]!)))return null;
 let count=0;
 while(!r.done()){
  const before=r.at;const label=r.rest().match(rex('(\\d+)\\.'));if(label)r.syntax('\\d+\\.');const scope=label?`項目${label[1]}`:undefined;
  const next='(?=\\s+\\d+\\.|$)';
  let ok=r.take('(CASE|DOCUMENT) NR\\s*:\\s*([A-Z0-9/-]+)\\.?',m=>`${m[1].toUpperCase()==='CASE'?'案件':'文書'}番号：${m[2]}。`,scope)
   ||r.take('LCA\\s*:\\s*(.+?)'+next,m=>`場所の名称（原文）：${clean(m[1])}。`,scope,m=>safeName(m[1]))
   ||r.take('THE AREA OVERLAPS (.+?),?\\s+ACFT ARE CTN ADZ\\.',m=>`活動区域は次の区域・経路と重なります（PART OFはその一部）：${clean(m[1]).replace(/,$/,'')}。航空機に注意を促しています。`,scope,m=>!/\b(?:EXCEPT|EXC|UNLESS|ONLY|BUT)\b/i.test(m[1]))
   ||r.take('(?:COOR|OPR) TEL\\s*:\\s*([+0-9 ,()-]+(?: EXTENSION \\d+)?)\\.?'+next,m=>`調整・運用連絡先：${clean(m[1])}。`,scope)
   ||r.take('AIRSPACE BLOCKED\\.',()=> '当該空域は閉鎖されます。',scope)
   ||r.take('GUN FRNG WILL TAKE PLACE\\.',()=> '砲・銃による射撃が行われます。',scope)
   ||r.take('UNMANNED ACFT WILL BE RELEASED\\.',()=> '無人航空機が飛行します。',scope)
   ||r.take('TFC CONCERNED KEEP CLOSE CTC WITH ([A-Z0-9 /,.-]+?)\\.',m=>`関係する航空機は${clean(m[1])}と緊密な通信連絡を維持するよう求められています。`,scope)
   ||r.take(`MAX HGT\\s*:\\s*(${ALT})\\.?`,m=>`最高高度：${semanticAltitude(m[1])}。`,scope)
   ||r.take('QUANTITY\\s*:\\s*(\\d+) PER DAY, ONE AT EACH TIME\\.?',m=>`数量：1日${m[1]}個、各回1個ずつ。`,scope)
   ||r.take('INTERVAL\\s*:\\s*(\\d+) MIN\\.?',m=>`放球間隔：${m[1]}分。`,scope)
   ||r.take(`SIZE\\s*:\\s*(${NUM})M IN DIAMETER\\.?`,m=>`気球の直径：${m[1]}m。`,scope)
   ||r.take(`WT\\s*:\\s*(${NUM})\\s*(KG|G)\\.?`,m=>`重量：${m[1]}${m[2].toLowerCase()}。`,scope)
   ||r.take(`THE ASCENT RATE\\s*:\\s*(${NUM})M/SEC\\.?`,m=>`上昇速度：毎秒${m[1]}m。`,scope)
   ||area(r,`区域${++count}`);
  if(ok)continue;
  // Numbering is kept in the exact unresolved source if the content was unsupported.
  r.at=before;break;
 }
 return r.result('taiwan-activity','活動内容と実施条件');
}
function specialOperations(r:Reader):SemanticInterpretation|null {
 if(!r.take('SPECIAL OPS \\(CLD SEEDING\\) WILL TAKE PLACE WI\\s*:',()=> '人工降雨のため、次の区域内で雲への播種作業が行われます。'))return null;
 if(area(r,'実施区域'))place(r);
 return r.result('cloud-seeding','人工降雨のための作業');
}
function simple(r:Reader):SemanticInterpretation|null {
 if(r.take('(DANGER|RESTRICTED|PROHIBITED) AREA (RK\\s*[RDP]\\s*\\d+[A-Z]?) ACT\\.?$',m=>`${m[1].toUpperCase()==='DANGER'?'危険':m[1].toUpperCase()==='RESTRICTED'?'制限':'飛行禁止'}区域${clean(m[2])}が有効になります。範囲は該当するAIPの区域定義で指定されています。`))return r.result('named-airspace','公示空域の有効化');
 if(r.take('OBST \\(VESSEL\\) PASS CMPL\\.?$',()=> '障害物として通知されていた船舶の通過が完了しています。'))return r.result('vessel-completion','船舶の通過完了');

 if(r.take('(UNMANNED ACFT|FIREWORKS|TEMPO (?:PROHIBITED|DANGER|RESTRICTED) AREA)\\s*:?\\s*NOTAM CNL\\.?$',m=>`${m[1]}に関する参照先NOTAMを取り消します。`))return r.result('cancellation','取消通知');
 if(r.take('CNL\\.(?:\\s*NEW NOTAM TO FLW\\.)?$',m=>/NEW NOTAM/i.test(m[0])?'参照先NOTAMを取り消します。新しいNOTAMが後続して発行される予定です。新しい通知の取得・内容は別途確認が必要です。':'参照先NOTAMを取り消します。'))return r.result('cancellation','取消通知');
 if(r.take('(?:AERODROME )?(RWY\\s+\\d{2}[LRC]?(?:/\\d{2}[LRC]?)?|TWY\\s+[A-Z0-9-]+|AD)\\s+(?:IS\\s+)?(?:CLSD|CLOSED)(?:\\s+TO ALL ACFT AND VEHICLE TRAFFIC)?\\.?$',m=>`${m[1].replace(/^RWY/,'滑走路').replace(/^TWY/,'誘導路').replace(/^AD$/,'飛行場')}は${/VEHICLE/.test(m[0])?'すべての航空機・車両の通行に対して':''}閉鎖されています。`))return r.result('closure','施設の閉鎖');
 if(r.take('FIREWORKS\\s*:',()=> '花火の打上げが行われます。')){let i=0;while(!r.done()){const before=r.at;r.syntax('\\(\\d+\\)');if(area(r,`打上げ区域${++i}`)||place(r))continue;r.at=before;break;}return r.result('fireworks','花火の打上げ');}
 return null;
}
function vorRestriction(raw:string, inherited:string):string|null {
 const t=raw.trim().replace(/\.$/,'');
 const exception=t.match(/^(.*?)(?:\s*\(\s*EXCEPT\s+(.*?)\s*\))$/i);
 let core=exception?exception[1].trim().replace(/\.$/,''):t;
 // Any exception text without a balanced, recognized whole parenthesis invalidates the block.
 if(/\bEXCEPT\b|[()]/.test(core))return null;
 const sentences:string[]=[];
 let scopedFacility=inherited, hasUnserviceable=false;
 for(const part of core.split(/,\s*/)){
  const a=part.match(/^(VOR\/DME|VOR|DME)?\s*U\/S (?:ON|BTN) RADIAL (\d{3})DEG-(\d{3})DEG CLOCKWISE$/i)
   ??part.match(/^(VOR\/DME|VOR|DME)?\s*(?:BTN|ON) RADIAL (\d{3})DEG-(\d{3})DEG CLOCKWISE$/i);
  if(a){if(+a[2]>360||+a[3]>360)return null;if(/U\/S/i.test(part))hasUnserviceable=true;else if(!hasUnserviceable)return null;scopedFacility=a[1]||scopedFacility;sentences.push(`${scopedFacility}は、施設を基準とする${a[2]}°ラジアルから時計回りに${a[3]}°ラジアルまでの扇形範囲で使用不能`);continue;}
  const b=part.match(/^(VOR\/DME|VOR|DME)?\s*U\/S BEYOND (\d+(?:\.\d+)?)NM ON RADIAL (\d{3})DEG(?: FOR (EN-ROUTE|HOLDING) PROCEDURE)?$/i);
  if(b){if(+b[3]>360)return null;hasUnserviceable=true;scopedFacility=b[1]||scopedFacility;sentences.push(`${scopedFacility}は、${b[3]}°ラジアル上で施設から${b[2]}海里を超える部分では${b[4]?`${b[4].toUpperCase()==='HOLDING'?'待機':'航空路'}方式において`:''}使用不能`);continue;}
  return null;
 }
 if(exception){const ex:string[]=[];for(const p of exception[2].split(/,\s*/)){const m=p.match(/^WI (\d+(?:\.\d+)?)NM ON RADIAL (\d{3})DEG FOR (EN-ROUTE|HOLDING) PROCEDURE$/i);if(!m||+m[2]>360)return null;ex.push(`${m[2]}°ラジアル上の施設から${m[1]}海里以内を${m[3].toUpperCase()==='HOLDING'?'待機':'航空路'}方式に使う場合`);}return sentences.join('。')+`。ただし、${ex.join('、および')}はこの使用不能範囲から除外されます。`;}
 return sentences.join('。')+'。';
}
function vor(r:Reader):SemanticInterpretation|null {
 let inherited='VOR/DME';
 if(!r.take(`([A-Z][A-Z ()/-]+?)\\s+(VOR/DME|VOR)\\s*'([A-Z0-9]+)'\\s*(${NUM})\\s*MHZ(?:/CH([A-Z0-9]+))?\\s+(?:LIMITED TO USE|LIMITATION CHANGED (?:AS FLW|TO))\\s*:`,m=>{inherited=m[2];return `${clean(m[1])}の${m[2]}「${m[3]}」（周波数${m[4]}MHz${m[5]?`、DMEチャネル${m[5]}`:''}）には、以下の利用制限があります。`;}))return null;
 while(!r.done()){
  const rest=r.rest();const item=rest.match(/^\d+\.\s*/);const from=item?item[0].length:0;
  const next=rest.slice(from).search(/\s+\d+\.\s*(?:VOR|DME|U\/S)/);const end=next<0?rest.length:from+next;
  const piece=rest.slice(from,end).trim();const translated=vorRestriction(piece,inherited);if(!translated)break;
  const escaped=rest.slice(0,end).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  r.take(escaped,()=>translated,item?`制限${item[0].replace(/\D/g,'')}`:'利用制限');
 }
 return r.result('vor-limitations','航法施設の利用制限');
}
/** Unknown families remain intact; no keyword-only block can become explained. */
export function interpretAviationBody(body:string):SemanticInterpretation {
 const parsers=[simple,obstacle,japaneseDrone,airspace,military,usDrone,taiwan,vor,specialOperations];
 for(const parse of parsers){const result=parse(new Reader(body));if(result)return result;}
 return new Reader(body).result('unsupported','本文の未対応書式');
}
