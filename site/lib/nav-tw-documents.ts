import reviewedPdfs from './nav-tw-reviewed-pdfs.json';
import reviewedOdts from './nav-tw-reviewed-odts.json';
import {twOdtContent,twOdtText} from './nav-tw-odt';
import type {TwReceipt} from './nav-tw-evidence';
export type TwExtractedDocument = {url:string;receipt:TwReceipt;text:string;format:'odt'|'pdf';review?:{pages:number;reviewedAt:string;method:string}};
type ReviewedPdf = {bytes:number;text:string;pages:number;reviewedAt:string;method:string};
// Content-addressed extraction cache: reviewed PDFs are accepted only when all
// bytes match. New/changed PDFs remain unsupported until a complete extractor
// or reviewed extraction is available. This is not a generic PDF parser.
export function extractTwDocument(bytes:Uint8Array,receipt:TwReceipt):TwExtractedDocument {
  if(bytes[0]===0x50&&bytes[1]===0x4b){
    const xml=twOdtContent(bytes),text=twOdtText(xml);
    if(!text.trim())throw new Error('ODT全文を抽出できません');
    const verified=(reviewedOdts as Record<string,{bytes:number;pages:number;reviewedAt:string;method:string}>)[receipt.sha256];
    if(!verified||verified.bytes!==bytes.length)return {url:receipt.url,receipt:{...receipt,extraction:'complete',reason:'ODTの全ネイティブテキストを抽出。未知の図・条件の意味照合は未完了'},text,format:'odt'};
    return {url:receipt.url,receipt:{...receipt,extraction:'complete'},text,format:'odt',review:{pages:verified.pages,reviewedAt:verified.reviewedAt,method:verified.method}};
  }
  if(new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-'){
    const entry=(reviewedPdfs as Record<string,ReviewedPdf>)[receipt.sha256];
    if(!entry||entry.bytes!==bytes.length||!entry.text.trim()||entry.pages<1)throw new Error('未検証PDF：全ページの抽出と表・図の確認が必要です');
    return {url:receipt.url,receipt:{...receipt,extraction:'complete'},text:entry.text,format:'pdf',review:{pages:entry.pages,reviewedAt:entry.reviewedAt,method:entry.method}};
  }
  throw new Error('対応文書でない応答です（ODT/PDF識別失敗）');
}
