import {getDocumentProxy,extractText} from 'unpdf';
import {linksIn,parseNavArticle} from './nav-ingest';
import type {NavSource} from './nav-sources';
// Only follow PDF links published by this official article, within the same
// origin. Every fetch is charged to the collector's existing request envelope.
export async function parseNavPdfArticle(html:string,url:string,source:NavSource,fetcher:(url:string)=>Promise<Response>){
 const links=linksIn(html,url).filter(l=>/\.pdf$/i.test(new URL(l.url).pathname)&&new URL(l.url).origin===new URL(url).origin);
 if(!links.length)return null;
 if(links.length!==1)throw Error('PDF添付複数：全添付の確認が必要');
 const target=links[0].url,response=await fetcher(target);
 if(!response.ok||response.redirected||response.headers.has('location')||(response.url&&response.url!==target)){await response.body?.cancel();throw Error(`PDF HTTP/転送エラー ${response.status}`);}
 const cap=4*1024*1024,length=Number(response.headers.get('content-length'));
 if(length>cap||!response.body){await response.body?.cancel();throw Error('PDF容量上限');}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>cap)throw Error('PDF容量上限');parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
 if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw Error('PDF形式不一致');
 const document=await getDocumentProxy(bytes,{isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
 try{
  if(document.numPages>6)throw Error('PDFページ上限');
  const {text}=await extractText(document,{mergePages:false});
  const pages=text as string[];
  if(pages.length!==document.numPages||pages.some(p=>p.trim().length<20))throw Error('PDF画像・空ページ：文字抽出未完了');
  const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const meta=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]).join('');
  const item=parseNavArticle(meta+'<div class="article-content">'+escape(pages.join('\n\n'))+'</div>',url,source);
  if(!item)throw Error('PDF警報本文未確認');
  item.text+='\n原文PDF: '+target;
  item.warnings.push(`公式添付PDF ${document.numPages}ページから文字抽出。図・画像の情報は原文で確認してください。`);
  return item;
 }finally{await document.loadingTask.destroy();}
}
