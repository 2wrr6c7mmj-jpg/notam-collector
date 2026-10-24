import type { NavSource } from './nav-sources';
import type { SourceRecord } from './nav-store';
import {twGet, twPriorBackoff, twStopEvidence, type TwBackoff,twText,twBoundBudget,type TwRequestBudget} from './nav-tw-evidence';
const root='https://www.mnd.gov.tw/API/api/';
export const twMndSources:NavSource[]=[
  {id:'tw-mnd-navigation',name:'台湾国防部 海軍航船布告（優先一次API）',region:'台湾周辺（海軍航船布告）',country:'TW',parser:'tw-mnd',url:root+encodeURIComponent('國防部海軍司令部航船布告')},
  {id:'tw-mnd-firing',name:'台湾国防部 海軍実弾射撃（優先一次API）',region:'台湾周辺（海軍実弾射撃）',country:'TW',parser:'tw-mnd',url:root+encodeURIComponent('國防部海軍司令部實彈射擊公告')},
];
// Verified Swagger routes are checked as primary source health. The real API
// presently errors. No fabricated success fixture authorizes future geometry.
export async function collectTwMndSource(source:NavSource,previous:SourceRecord,fetcher:typeof fetch=fetch,budget?:TwRequestBudget,options:{allowProbe?:boolean}={}):Promise<SourceRecord>{
  if(!options.allowProbe)return {...previous,status:{...previous.status,...source,detail:'定期API再試行は停止中。依頼された単発確認だけを別途行います。保存状態・前回確認日時を保持。'}};
  const backoff=twPriorBackoff(previous as SourceRecord&{taiwanBackoff?:TwBackoff});if(backoff)return {...previous,status:{...previous.status,detail:`発表元の再試行待機中（${new Date(backoff.until).toISOString()}まで）。保存データを保持。`}};
  const checkedAt=Date.now();
  try{
    const response=await twGet(source.url,['www.mnd.gov.tw'],fetcher,checkedAt+10_000,64*1024,twBoundBudget(budget,1),'listing');
    const data:unknown=JSON.parse(twText(response.bytes));
    if(!Array.isArray(data))throw new Error('国防部APIは公告配列を返しませんでした');
    return {...previous,taiwanMndProbe:response.receipt,status:{...previous.status,...source,state:'partial',checkedAt,count:previous.items.length,pages:1,detail:`国防部APIが${data.length}行を返しました。復旧後の実データ形式・期間・座標の再検証待ち。未解析の応答を有効な区域や警告0件として表示していません。`}} as SourceRecord;
  }catch(error){return {...previous,...(twStopEvidence(error)?{taiwanBackoff:twStopEvidence(error)}:{}),status:{...previous.status,...source,state:'error',checkedAt,count:previous.items.length,pages:0,detail:`${error instanceof Error?error.message:'国防部API取得失敗'}。一次情報の取得失敗です。警告0件ではありません。保存済み原文があれば取得日時とともに保持。農業部・航港局は補助情報として別に表示。`}};}
}
