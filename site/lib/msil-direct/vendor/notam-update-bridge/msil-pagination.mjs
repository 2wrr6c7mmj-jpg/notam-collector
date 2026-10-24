import {pageState} from './msil-stage.mjs';
import crypto from 'node:crypto';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Pure planner: no fetch, timers, credentials, persistence, retries or scheduling.
export function planNextPage(pages,{layer,limit=1000,maxPages=3,maxFeatures=3000,maxBytes=8*1024*1024,minIntervalMs=3000,maxWindowMs=60000,now=Date.now()}={}){
 if(![1,2,3].includes(layer)||!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(maxPages)||maxPages<1||maxPages>10||!Number.isInteger(maxFeatures)||maxFeatures<1||maxFeatures>10000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024||!Number.isFinite(minIntervalMs)||minIntervalMs<3000||!Number.isFinite(now))throw Error('Invalid MSIL pagination budget');
 if(!Array.isArray(pages))throw Error('MSIL receipt list required');
 if(!Number.isFinite(maxWindowMs)||maxWindowMs<minIntervalMs||maxWindowMs>300000)throw Error('Invalid MSIL collection window');
 let nextOffset=0,featureCount=0,bytes=0,lastAt=null;const fingerprints=new Set(),features=new Set();
 for(const input of pages){
  if(input.layer!==layer||!Number.isFinite(input.receivedAt)||input.receivedAt>now||input.offset!==nextOffset)throw Error('MSIL pagination receipt conflict');
  const s=pageState(input.page,input);if(fingerprints.has(s.sha256))throw Error('Repeated MSIL page');fingerprints.add(s.sha256);
  if(lastAt!==null&&input.receivedAt<lastAt)throw Error('MSIL receipt time regressed');
  for(const f of input.page.features){const id=hash(f);if(features.has(id))throw Error('Repeated MSIL feature across pages; ordering may have changed');features.add(id);}
  const n=Buffer.byteLength(JSON.stringify(input.page));bytes+=n;featureCount+=s.count;lastAt=input.receivedAt;nextOffset=s.nextOffset;
 }
 const common={layer,receivedPages:pages.length,featureCount,bytes,consistencyVerified:false,publishable:false};
 if(pages.length&&now-pages[0].receivedAt>maxWindowMs)return{...common,action:'stop',reason:'collection-window-exceeded',transportComplete:nextOffset===null};
 if(nextOffset===null)return{...common,action:'stop',reason:'server-end-of-layer',transportComplete:true};
 if(pages.length>=maxPages||maxFeatures-featureCount<limit||bytes>=maxBytes)return{...common,action:'stop',reason:'budget-exhausted',transportComplete:false};
 return{...common,action:'read-one-page',offset:nextOffset,limit,maxResponseBytes:Math.min(64*1024*1024,maxBytes-bytes),notBefore:lastAt===null?now:Math.max(now,lastAt+minIntervalMs),transportComplete:false};
}
