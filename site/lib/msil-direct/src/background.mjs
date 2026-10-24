import {createD1SourceStore} from './store.mjs';
import {refreshSavedTrial} from './service.mjs';

export const BACKGROUND_BUDGET_MS = 25000;
export const BACKGROUND_ACQUISITION_MS = 20000;
const stopped = (signal,now,end) => signal.aborted || now()>=end;

// D1 itself has no AbortSignal cancellation contract. Stop awaiting a stuck call
// and never start its continuation after expiry; a submitted transaction may
// still settle atomically. Shared lease ownership/expiry protects later writers.
function budgeted(operation,signal,now,end) {
  if(stopped(signal,now,end))return Promise.reject(Error('MSIL background deadline'));
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(Error('MSIL background deadline'));
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{
      if(stopped(signal,now,end))throw Error('MSIL background deadline');
      return operation();
    }).then(value=>{
      if(stopped(signal,now,end))throw Error('MSIL background deadline');
      resolve(value);
    }).catch(reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}

// Internal dependency injection supports deterministic lifecycle tests. The
// existing HTTP route supplies only its DB binding and real request context.
export function createBackgroundMsilHook({fetcher=fetch,now=Date.now,wait,
  makeStore=createD1SourceStore,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  return function schedule(db,ctx) {
    let admitted=false;
    // Queue no I/O until the real request context has accepted the promise.
    const work=Promise.resolve().then(async()=>{
      if(!admitted)return;
      const controller=new AbortController(),start=now(),end=start+BACKGROUND_BUDGET_MS;
      const timer=setTimer(()=>controller.abort(),BACKGROUND_BUDGET_MS);
      try {
        const base=makeStore(db),signal=controller.signal;
        const store=Object.fromEntries(['read','claim','commit'].map(name=>[name,(...args)=>budgeted(()=>base[name](...args),signal,now,end)]));
        await refreshSavedTrial({store,fetcher,now,wait,signal,deadlineAt:end,
          acquisitionWindowMs:BACKGROUND_ACQUISITION_MS,metadataOnly:true,claimFirst:true});
      } catch { /* Independent from the primary response; never echo upstream errors. */ }
      finally { clearTimer(timer);controller.abort(); }
    }).catch(()=>{});
    try {
      if(!ctx||typeof ctx.waitUntil!=='function')return false;
      ctx.waitUntil(work);
      admitted=true;
      return true;
    } catch { return false; }
  };
}

export const scheduleMsilRefresh=createBackgroundMsilHook();
