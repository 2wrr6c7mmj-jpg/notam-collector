// Reviewed text relations only. No live-source deletion, geometry replacement, time inference or publication.
import crypto from 'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const normalized=s=>s.replace(/\s+/gu,' ').trim();
function warningParts(text,kind){
 const prefix=kind==='msil'?'NAVAREA航行警報[：:]':'NO\\.';
 const match=text.match(new RegExp('^'+prefix+'(\\d{2}-\\d{4})\\s+発表日時[：:]\\s*(\\d{4})年(\\d{2})月(\\d{2})日\\s*(\\d{2})時\\s*\\n([\\s\\S]+)$'));
 if(!match)return null;let body=match[6];if(kind==='msil'){if(!body.endsWith('[利用上の制限事項]'))return null;body=body.slice(0,-'[利用上の制限事項]'.length);}
 return{number:match[1],publicationTextFields:match.slice(2,6).join('-'),body:normalized(body)};
}
export function verifyTextDuplicate(msil,existing){
 const base={msilIdentity:msil.identity,existingId:existing.id,applied:false,preserveBothGeometries:true,periodsUnchanged:true};
 let url;try{url=new URL(existing.sourceUrl);}catch{return{...base,status:'review',reason:'missing-source-link'};}
 const a=warningParts(msil.text,'msil'),b=warningParts(existing.text,'existing');
 const sameSource=msil.warningSeries==='NAVAREA航行警報'&&msil.sourceLinks?.includes('https://www1.kaiho.mlit.go.jp/TUHO/keiho/navarea11.html')&&existing.sourceCountry==='JP'&&existing.id==='NAVAREA XI '+msil.warningNumber&&url.protocol==='https:'&&url.hostname==='www1.kaiho.mlit.go.jp'&&!url.username&&!url.password&&url.pathname==='/TUHO/keiho/cgi/disp_warnings.cgi'&&url.searchParams.get('TYPE')==='NAVAREA11'&&url.searchParams.get('TANA')===msil.warningNumber.replace('-','');
 if(!sameSource||!a||!b||a.number!==b.number||a.number!==msil.warningNumber)return{...base,status:'review',reason:'identity-or-series-not-confirmed'};
 const samePublication=a.publicationTextFields===b.publicationTextFields,sameBody=a.body===b.body;
 return{...base,status:samePublication&&sameBody?'verified-same-warning-text':'review',reason:!samePublication?'publication-text-differs':!sameBody?'body-differs':'series-number-publication-and-body-match',publicationTextFields:a.publicationTextFields,publicationInstant:null,msilCanonicalBodySHA256:hash(a.body),existingCanonicalBodySHA256:hash(b.body)};
}
export function reviewCancellation(item){
 return item.evidence.cancellationEvidence.map(({raw})=>{
  const base={raw,applied:false,changesActivityEnd:false,cancelled:null};
  if(/^CANCEL THIS MSG\s+.+\.$/.test(raw))return{...base,kind:'scheduled-self-cancellation',targets:[{identity:item.identity}],scheduledRaw:raw.slice(16,-1),scheduledInstant:null,needsTimeReview:true,alternateScheduleReviewRequired:/\bALTERNATE\b/.test(item.text)};
  const english=raw.match(/^CANCEL (\d{4}\/\d{2}(?: AND \d{4}\/\d{2})*)\.$/);
  if(english&&item.warningSeries==='NAVAREA航行警報'){
   const targets=english[1].split(' AND ').map(t=>{const[n,y]=t.split('/');return{raw:t,warningNumber:y+'-'+n,identity:item.warningSeries+':'+y+'-'+n,yearInIdentifierExplicit:true};});
   const self=targets.some(t=>t.identity===item.identity);return{...base,kind:self?'self-reference-needs-review':'other-warning-delete',targets,targetIdentityComplete:true};
  }
  const regional=raw.match(/([一二三四五六七八九十]+管区地域航行警報)\s*(令和\s*\d+年\s*)?番号\s*(\d+)\s*(?:は[、,]?\s*)?削除(?:します)?/);
  const abbreviated=raw.match(/^[（(](?:(\d+年))?(\d{1,4})削除[）)]$/);
  if(regional||abbreviated){
   const series=regional?.[1]||item.warningSeries,serial=Number(regional?.[3]||abbreviated[2]),yearRaw=(regional?.[2]||abbreviated?.[1]||'').trim()||null;
   const ownSerial=item.localSerial??Number(item.warningNumber.split('-').at(-1));
   return{...base,kind:series===item.warningSeries&&serial!==ownSerial?'other-warning-delete':'target-needs-review',targets:[{series,serial,yearRaw,warningNumber:null,identity:null}],targetIdentityComplete:false,reason:'target-year-or-complete-identifier-not-inferred'};
  }
  return{...base,kind:'unresolved',targets:[],reason:'unsupported-cancellation-expression'};
 });
}
export function reviewActivity(item){
 const lines=item.text.split('\n').map(s=>s.trim());
 const rules=[['missile-firing',/^ミサイル射撃(?=[、。\s\d]|$)/],['rocket-firing',/^ロケット射撃(?=[、。\s\d]|$)/],['rocket-launch',/^(?:ロケット打上げ(?=[、。\s\d]|$)|ROCKET LAUNCHING\.)/],['gunnery',/^(?:射撃(?:及びフレア発射)?(?=[、。\s\d]|$)|GUNNERY\.)/],['bombing',/^(?:爆撃(?=[、。\s\d]|$)|BOMBING\.)/]];
 const matches=[];for(const[subtype,pattern]of rules)for(const line of lines)if(pattern.test(line))matches.push({subtype,raw:line});
 const contradictory=lines.filter(l=>/(?:射撃|爆撃|ロケット打上げ).{0,16}(?:中止|取消|実施しません|実施しない)|\bNO (?:FIRING|BOMBING)\b|\b(?:FIRING|BOMBING) (?:CANCELLED|CANCELED)\b/i.test(l));
 const titleMatches=/射撃|爆撃|ロケット打上げ/.test(item.name);
 return{status:matches.length&&titleMatches&&!contradictory.length?'verified-activity-topic':'review',category:matches.length?'firing':null,subtypes:[...new Set(matches.map(x=>x.subtype))],evidence:matches,contradictory,applied:false,scope:'activity-topic-only',reviewRequiredForUnseenText:true,activeAtTime:null,periodsUnchanged:true,cancellationUnchanged:true};
}
