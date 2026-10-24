import {englishUtcMaritimeAnalysis} from './nav-english-utc-periods';
import {hasBombingActivity} from './bombing-activity.mjs';
import type {Notice} from './notam';
import {navShapes,navGeometryWarnings,navGeometryWarningMessages} from './nav-warning';
import {navPeriodAnalysis} from './nav-period';
/** Browser-only re-interpretation; original API and stored source rows are untouched. */
export function projectDisplayNotice(n:Notice):Notice{
 const purpose:Notice['purpose']=hasBombingActivity(n.text)?'firing':n.purpose;
 if((n.sourceCountry||'CN')!=='CN')return purpose===n.purpose?n:{...n,purpose};
 if(n.cancelled)return {...n,shapes:[]};
 const shapes=navShapes(n.text),analysis=navPeriodAnalysis(n.text,n.issued),english=analysis.periods.length?null:englishUtcMaritimeAnalysis(n.text,n.issued),periods=analysis.periods.length?analysis.periods:english?.periods||[];
 return {...n,purpose,shapes,validityPeriods:periods,start:periods.length?Math.min(...periods.map(p=>p.start)):null,end:periods.length?Math.max(...periods.map(p=>p.end)):null,timeUncertain:!periods.length||(analysis.periods.length?analysis.unparsedClauses.length>0:english?.timeUncertain!==false),warnings:[...new Set([...n.warnings.filter(w=>!navGeometryWarningMessages.includes(w)),...navGeometryWarnings(n.text,shapes)])]};
}
