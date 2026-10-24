// Evidence extraction only: no dates, cancellation or categories are applied to the live model.
export function officialLinks(html){
 const links=[];for(const m of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)){
  try{const u=new URL((m[1]??m[2]).replace(/&amp;/g,'&'));if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)continue;
   if((u.hostname==='www1.kaiho.mlit.go.jp'&&/^\/TUHO\/keiho\/[\w./-]+\.html$/.test(u.pathname))||(u.hostname==='www.msil.go.jp'&&u.pathname==='/data/gis-link-file/NwNtm/NwNtmConstraints_j.pdf'))links.push(u.href);
  }catch{}
 }return [...new Set(links)];
}
export function warningIdentity(name,text,links=[]){
 const standard=text.match(/^(NAVAREA航行警報|NAVTEX航行警報|日本航行警報)[：:]\s*([0-9]{2,4}-[0-9]{1,8})\b/);
 if(standard)return{warningSeries:standard[1],warningNumber:standard[2],localSerial:null,identity:standard[1]+':'+standard[2]};
 const district=text.match(/([一二三四五六七八九十]+管区地域航行警報)\s*番号\s*(\d+)/),prefix=name.match(/^(\d{2})-(\d{2})(\d{4})\s/);
 const districts={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11};
 if(district&&prefix){const area=Number(prefix[1]),serial=Number(prefix[3]),labelArea=districts[district[1].replace('管区地域航行警報','')];
  if(area!==labelArea||serial!==Number(district[2])||!links.some(u=>u.endsWith(`/kanku/${prefix[1]}kanku.html`)))throw Error('MSIL district identity evidence conflicts');
  const number=prefix[1]+'-'+prefix[2]+prefix[3];return{warningSeries:district[1],warningNumber:number,localSerial:serial,identity:district[1]+':'+number};
 }throw Error('Unrecognized MSIL warning identity');
}
export function semanticEvidence(item){
 const lines=item.text.split('\n').map(s=>s.trim()).filter(Boolean);
 const explicit=lines.find(l=>/^発表日時[：:]/.test(l));
 const regional=lines.find(l=>/(?:\d{4}年)?\d{1,2}月\d{1,2}日\s*\d{4}\s*発表/.test(l));
 const issuedRaw=explicit?.replace(/^発表日時[：:]\s*/,'')||regional?.match(/(?:\d{4}年)?\d{1,2}月\d{1,2}日\s*\d{4}\s*発表/)?.[0]||null;
 const cancellations=lines.filter(l=>/取消|削除|解除|中止|終了|復旧|\bCANCEL(?:LED)?\b/i.test(l)).map(raw=>{
  const numbers=[...raw.matchAll(/\b\d{2,4}-\d{1,8}\b/g)].map(m=>m[0]),locals=[...raw.matchAll(/番号\s*(\d+)/g)].map(m=>Number(m[1]));
  const own=numbers.includes(item.warningNumber)||(item.localSerial!==null&&locals.includes(item.localSerial));
  return{raw,numbers,localSerials:locals,relation:own?'self-reference-needs-review':numbers.length||locals.length?'other-warning-reference':'unspecified',applied:false};
 });
 const periodLines=lines.filter(l=>l!==explicit&&l!==regional&&!/^.*航行警報[：:]/.test(l)&&/(?:\d{1,2}月\d{1,2}日|\d{4}Z|\bUTC\b|\bJST\b|当分の間|追って|UNTIL FURTHER NOTICE|\bDAILY\b)/i.test(l));
 const firing=/射撃|射爆撃|爆撃|実弾|爆破|ロケット|ミサイル|\b(?:FIRING|GUNNERY|BOMBING|ROCKET|MISSILE)\b/i;
 const classificationLines=[item.name,...lines].filter(l=>firing.test(l));
 return{providerMembership:'provider-labelled-valid-within-last-five-years',activeAtTime:null,cancelled:null,
  publication:{raw:issuedRaw,instant:null,yearExplicit:!!issuedRaw&&/\d{4}年/.test(issuedRaw),timezoneVerified:false},
  period:{raw:periodLines,periods:[],reviewRequired:true,openEndedText:periodLines.some(l=>/当分の間|追って|UNTIL FURTHER NOTICE/i.test(l)),yearInPeriodText:periodLines.some(l=>/\d{4}年/.test(l)),explicitZoneInText:periodLines.some(l=>/\d{4}Z|\bUTC\b|\bJST\b/i.test(l))},
  cancellationEvidence:cancellations,
  classification:{candidate:classificationLines.length?'firing':'other',evidence:classificationLines,applied:false,reviewRequired:true},
  sourceLinks:item.sourceLinks,issuerCountry:'JP',geographicRegions:null};
}
