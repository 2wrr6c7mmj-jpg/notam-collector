import crypto from 'node:crypto';
import {parseMsilPeriods} from './msil-periods.mjs';
import {englishAnchors,englishProofs} from './msil-official-time-proofs.mjs';
import {sourceTimeZoneOptions,explicitTimeZoneOptions,recognizedSource} from './msil-time-basis.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
// Individually reviewed exact pairs, not a convention for NAVTEX or Japan warnings.
const proofs=[{"identity": "NAVTEX航行警報:26-1887", "sha": "d5bf5e453ad957022a911230207bf950c164d64769a3b7818b966512602c7840", "anchor": "日本航行警報:26-3889", "anchorSha": "fdb9cdf306ea8be05fafdffe193703171a51ed5e71a19b5c294a3a473bd978e2"}, {"identity": "日本航行警報:26-3787", "sha": "a6ed6b445722b84ea357e29059decaac0ff2d2e6af91313dd48e2d4781ce8d4f", "anchor": "NAVAREA航行警報:26-0430", "anchorSha": "eb327474b6e7dab5d9f3594116ce98e8c2fd927ce074d941a3875df738f9a018"}, {"identity": "NAVTEX航行警報:26-1886", "sha": "aef329fba725c7e1bbfd3d73eceae6c1c9dab0cbfaec87aee458e051e22e3d4b", "anchor": "日本航行警報:26-3888", "anchorSha": "19e9a71f1ef96847d139cc7a3fdd975534daa270a19f2204b191aa63add56d50"}, {"identity": "NAVTEX航行警報:26-1851", "sha": "8e83d40e8e2c8b045b546b0cc8354e1b3157fbe187d319e184d24082f40918ea", "anchor": "日本航行警報:26-3795", "anchorSha": "0f61a6d98016e3c43bb296ca7f85d5f8aa3d7c7775c304a239380e231345bc09"}, {"identity": "NAVTEX航行警報:26-1885", "sha": "35dbefbb31c8c0984209b4c6bd6f4a111fa949ff9a175112fa34d009e90732d5", "anchor": "日本航行警報:26-3886", "anchorSha": "d16dcd16def3bca10547d33065022616d6da984414c9c81eb9f48764535e8010"}];
// Official English counterparts establish the offset for these exact notices.
// Primary-only exceptions keep conflicting reserve calendars explicitly visible.
function verifiedOfficialEnglishOptions(source){
 const proof=englishProofs.find(p=>p.identity===source.identity&&hash(source.text)===p.sha);
 if(!proof||!Array.isArray(source.geometries)||hash(JSON.stringify(source.geometries))!==proof.geometrySha)return undefined;
 const anchor=englishAnchors.find(a=>a.identity===proof.anchor&&hash(a.text)===proof.anchorTextSha&&a.textSha256===proof.anchorTextSha);
 if(!anchor)return undefined;
 const options={defaultZone:'JST',zoneEvidence:{kind:'reviewed-official-english-counterpart',scope:proof.identity,anchorIdentity:anchor.identity,url:anchor.url,sourceTextSHA256:proof.sha,sourceGeometrySHA256:proof.geometrySha,anchorTextSHA256:proof.anchorTextSha,anchorHtmlSHA256:anchor.htmlSha256,retrievedAt:anchor.retrievedAt,...(proof.areaLabel?{areaLabel:proof.areaLabel}:{}),rule:'同一警報の原文・区域・日付・明記UTCを照合したUTC+09:00。当該原文のみ。'},...(proof.discrepancy?{sourceDiscrepancies:[proof.discrepancy]}:{})};
 const candidate=parseMsilPeriods(source,options),reference=parseMsilPeriods(anchor);
 const periods=proof.areaLabel?candidate.areaPeriods?.find(a=>a.areaLabel===proof.areaLabel)?.periods:candidate.periods;
 const bounds=ps=>JSON.stringify((ps||[]).map(p=>[p.start,p.end]));
 const allowed=new Set(['alternate-dates-require-review','alternate-and-self-cancellation-require-review','remaining-activity-time-needs-review','source-alternate-calendar-conflict']);
 if(!periods?.length||candidate.reasons.some(r=>!allowed.has(r))||reference.reasons.some(r=>!allowed.has(r))||candidate.cancellation.state==='cancelled'||bounds(periods)!==bounds(reference.periods))return undefined;
 if(!proof.primaryOnly&&bounds(candidate.alternatePeriods)!==bounds(reference.alternatePeriods))return undefined;
 return options;
}
function exactTimeZoneOptions(source,items=[]){
 const official=verifiedOfficialEnglishOptions(source);if(official)return official;
 const proof=proofs.find(p=>p.identity===source.identity);
 if(!proof||hash(source.text)!==proof.sha)return undefined;
 const anchor=items.find(x=>x.identity===proof.anchor&&hash(x.text)===proof.anchorSha);
 if(!anchor||!Array.isArray(source.geometries)||!source.geometries.length||JSON.stringify(source.geometries)!==JSON.stringify(anchor.geometries))return undefined;
 const options={defaultZone:'JST',zoneEvidence:{kind:'reviewed-exact-warning-pair',scope:proof.identity,anchorIdentity:proof.anchor,sourceTextSHA256:proof.sha,anchorTextSHA256:proof.anchorSha,rule:'当該警報の原文・同一座標・日付を照合し、明記UTCと一致するUTC+09:00。系列全体には適用しない。'}};
 const candidate=parseMsilPeriods(source,options),reference=parseMsilPeriods(anchor);
 const bounds=r=>r.periods.map(p=>[p.start,p.end]);
 if(candidate.completeness!=='complete'||reference.completeness!=='complete'||!reference.periods.length||JSON.stringify(bounds(candidate))!==JSON.stringify(bounds(reference)))return undefined;
 return options;
}

// Exact comparisons remain useful corroboration and preserve recorded source
// discrepancies. They are no longer an admission requirement for a new warning.
export function verifiedTimeZoneOptions(source,items=[]){
 const explicit=explicitTimeZoneOptions(source);if(explicit)return explicit;
 if(!recognizedSource(source))return undefined;
 const exact=exactTimeZoneOptions(source,items);if(exact)return exact;
 const rule=sourceTimeZoneOptions(source);if(!rule)return undefined;
 // A whitespace/rewording change does not erase a still-present known conflict.
 const discrepancy=englishProofs.find(p=>p.identity===source.identity&&p.discrepancy&&source.text.normalize('NFKC').replace(/[−―‐–—－]/g,'-').includes(p.discrepancy.source.normalize('NFKC').replace(/[−―‐–—－]/g,'-')))?.discrepancy;
 return discrepancy?{...rule,sourceDiscrepancies:[discrepancy]}:rule;
}
