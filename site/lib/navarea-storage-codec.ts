import {gzipSync} from 'fflate';

// Lossless, private storage only. The D1 row limit is unchanged; decoding has a
// separate hard bound so a damaged envelope cannot allocate without a limit.
export const NAVAREA_STORAGE_BYTES=1_800_000;
export const NAVAREA_DECODED_BYTES=8_000_000;
export const NAVAREA_COMPRESSED_PREFIX='nav-reviewed-source:gzip:v1:';
export const isNavareaStorageId=(id:string)=>['navarea-x','navarea-xiv','navarea-ix'].includes(id);
export function encodeNavareaStorage(record:unknown):string{
 const raw=new TextEncoder().encode(JSON.stringify(record));
 if(raw.length>NAVAREA_DECODED_BYTES)throw Error('Private NAVAREA decoded capacity reached');
 const zip=gzipSync(raw,{level:6,mtime:0});let binary='';
 for(let offset=0;offset<zip.length;offset+=8192)binary+=String.fromCharCode(...zip.subarray(offset,offset+8192));
 return JSON.stringify({format:'navarea-gzip-v1',rawBytes:raw.length,payload:btoa(binary)});
}
export function navareaStorageBytes(record:unknown):number{
 try{return new TextEncoder().encode(encodeNavareaStorage(record)).length;}catch{return Infinity;}
}
export async function decodeNavareaStorage(serialized:string):Promise<unknown>{
 if(new TextEncoder().encode(serialized).length>NAVAREA_STORAGE_BYTES)throw Error('Private NAVAREA storage capacity');
 const value=JSON.parse(serialized);
 if(value?.format!=='navarea-gzip-v1'||!Number.isSafeInteger(value.rawBytes)||value.rawBytes<1||value.rawBytes>NAVAREA_DECODED_BYTES||typeof value.payload!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.payload))throw Error('Invalid private NAVAREA envelope');
 const binary=atob(value.payload),zip=Uint8Array.from(binary,c=>c.charCodeAt(0));
 const reader=new Blob([zip]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>value.rawBytes||size>NAVAREA_DECODED_BYTES)throw Error('Private NAVAREA decoded capacity');parts.push(part.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(size!==value.rawBytes)throw Error('Private NAVAREA length mismatch');
 const raw=new Uint8Array(size);let at=0;for(const part of parts){raw.set(part,at);at+=part.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
}
