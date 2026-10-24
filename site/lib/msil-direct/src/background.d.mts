export type MsilRequestContext={waitUntil(promise:Promise<unknown>):void};
export const BACKGROUND_BUDGET_MS:number;
export const BACKGROUND_ACQUISITION_MS:number;
export function scheduleMsilRefresh(db:unknown,ctx?:MsilRequestContext):boolean;
export function createBackgroundMsilHook(options?:{
  fetcher?:typeof fetch;now?:()=>number;wait?:(ms:number,signal:AbortSignal)=>Promise<void>;
  makeStore?:(db:unknown)=>unknown;setTimer?:typeof setTimeout;clearTimer?:typeof clearTimeout;
}):(db:unknown,ctx?:MsilRequestContext)=>boolean;
