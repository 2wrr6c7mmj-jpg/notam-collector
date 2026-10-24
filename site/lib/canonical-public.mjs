const pages=new Set(['/','/about','/how-to','/coverage','/locations','/methodology','/privacy','/terms']);
// The legacy host remains the acquisition API. Readers use the one Pages UI.
export function canonicalPublicUrl(request){
 const url=new URL(request.url);
 return ['GET','HEAD'].includes(request.method)&&pages.has(url.pathname)
  ?'https://notam-watch.pages.dev'+url.pathname+url.search:null;
}
