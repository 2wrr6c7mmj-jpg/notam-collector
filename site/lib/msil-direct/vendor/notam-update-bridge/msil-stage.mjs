// Offline staging only. This module is not imported by compile.mjs or any viewer.
import crypto from 'node:crypto';
import {officialLinks,warningIdentity,semanticEvidence} from './msil-evidence.mjs';
const fail=(ok,message)=>{if(!ok)throw Error(message);};
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const MSIL_ATTRIBUTION='このサービスは、海しるAPIを利用して取得した情報をもとに作成しているが、サービスの内容は海上保安庁によって保証されたものではない';
export const MSIL_CONSTRAINTS='https://www.msil.go.jp/data/gis-link-file/NwNtm/NwNtmConstraints_j.pdf';
// Produces text, never renderable HTML. Unknown entities remain literal text.
export function descriptionText(value){
 fail(typeof value==='string'&&value.length<=200000,'Invalid MSIL description');
 const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
 return value.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|tr|li)\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>{if(e[0]!=='#')return entities[e.toLowerCase()];const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'\ufffd';}).replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
function latLon(p){fail(Array.isArray(p)&&p.length>=2&&p.length<=3&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90,'Invalid MSIL coordinate');return [p[1],p[0]];}
function line(points,ring=false){fail(Array.isArray(points)&&points.length>=(ring?4:2),'Invalid MSIL line/ring');const result=points.map(latLon);if(ring)fail(result[0][0]===result.at(-1)[0]&&result[0][1]===result.at(-1)[1],'Open MSIL polygon ring');return result;}
export function geometryShapes(g){
 fail(g&&typeof g==='object','Missing MSIL geometry');
 const polygon=c=>{fail(Array.isArray(c)&&c.length>0,'Empty MSIL polygon');return{kind:'polygon',points:line(c[0],true),holes:c.slice(1).map(r=>line(r,true))};};
 let shapes;
 switch(g.type){
  case 'Point':shapes=[{kind:'point',points:[latLon(g.coordinates)]}];break;
  case 'MultiPoint':fail(Array.isArray(g.coordinates)&&g.coordinates.length>0,'Empty multipoint');shapes=g.coordinates.map(p=>({kind:'point',points:[latLon(p)]}));break;
  case 'LineString':shapes=[{kind:'line',points:line(g.coordinates)}];break;
  case 'MultiLineString':fail(Array.isArray(g.coordinates)&&g.coordinates.length>0,'Empty multiline');shapes=g.coordinates.map(c=>({kind:'line',points:line(c)}));break;
  case 'Polygon':shapes=[polygon(g.coordinates)];break;
  case 'MultiPolygon':fail(Array.isArray(g.coordinates)&&g.coordinates.length>0,'Empty multipolygon');shapes=g.coordinates.map(polygon);break;
  default:throw Error('Unsupported MSIL geometry type');
 }
 return shapes.map(s=>({...s,sourceReference:'MSIL API official geometry'}));
}
export function pageState(page,{layer,offset=0,limit=1000}={}){
 fail([1,2,3].includes(layer)&&Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=1000,'Invalid MSIL page request');
 fail(page?.type==='FeatureCollection'&&Array.isArray(page.features)&&!page.error&&page.features.length<=limit,'Invalid MSIL GeoJSON page');
 if(page.crs)fail(page.crs.type==='name'&&/^(?:urn:ogc:def:crs:OGC:1\.3:CRS84|urn:ogc:def:crs:EPSG::4326|EPSG:4326)$/.test(page.crs.properties?.name||''),'Unexpected MSIL coordinate reference system');
 const marker=page.exceededTransferLimit??page.properties?.exceededTransferLimit;
 fail(marker===undefined||typeof marker==='boolean','Invalid transfer-limit flag');
 const incomplete=marker===true||(marker===undefined&&page.features.length===limit);
 fail(!incomplete||page.features.length>0,'Empty truncated MSIL page');
 return{layer,offset,limit,count:page.features.length,complete:!incomplete,nextOffset:incomplete?offset+page.features.length:null,sha256:sha(page)};
}
export function prepareMsil(pages){
 fail(Array.isArray(pages)&&pages.length>0,'MSIL pages required');
 const groups=new Map(),layers=new Map(),pageHashes=new Set();let featureCount=0;
 for(const input of pages){
  const state=pageState(input.page,input),previous=layers.get(input.layer);
  fail(previous?previous.nextOffset===state.offset:state.offset===0,'Noncontiguous MSIL pagination');
  const pageKey=input.layer+':'+state.sha256;fail(!pageHashes.has(pageKey),'Repeated MSIL page');pageHashes.add(pageKey);layers.set(input.layer,state);
  for(const f of input.page.features){
   fail(f?.type==='Feature'&&typeof f.properties?.name==='string','Invalid MSIL feature');
   fail(({1:['Point','MultiPoint'],2:['LineString','MultiLineString'],3:['Polygon','MultiPolygon']})[input.layer].includes(f.geometry?.type),'MSIL geometry differs from requested layer');
   const text=descriptionText(f.properties.description),sourceLinks=officialLinks(f.properties.description),identityEvidence=warningIdentity(f.properties.name,text,sourceLinks);
   const {identity}=identityEvidence,shapes=geometryShapes(f.geometry),bodyHash=sha(text);
   const old=groups.get(identity);fail(!old||old.bodyHash===bodyHash,'Conflicting MSIL text for one warning; manual review required');
   const group=old||{...identityEvidence,sourceLinks,name:f.properties.name,text,bodyHash,issuedRaw:text.match(/発表日時[：:]([^\n]+)/)?.[1]?.trim()||null,issued:null,start:null,end:null,timeUncertain:true,purpose:'other',classificationReviewed:false,geometryOrigin:'msil-official',geometries:[],shapes:[],geometryHashes:new Set(),sourceLayers:new Set(),featureCount:0};
   fail(group.name===f.properties.name,'Conflicting MSIL names for one warning');
   const geometryHash=sha(f.geometry);if(!group.geometryHashes.has(geometryHash)){group.geometries.push(structuredClone(f.geometry));group.shapes.push(...shapes);group.geometryHashes.add(geometryHash);}group.featureCount++;group.sourceLayers.add(input.layer);groups.set(identity,group);featureCount++;
  }
 }
 const complete=[1,2,3].every(layer=>layers.get(layer)?.complete);
 const items=[...groups.values()].map(({geometryHashes,sourceLayers,...g})=>{const evidence=semanticEvidence(g);return{...g,issuedRaw:evidence.publication.raw,evidence,sourceLayers:[...sourceLayers],warnings:['期間・取消状態・分類は未検証です。','海しる掲載情報は過去5年以内の有効分という提供者の区分です。活動期間を確定するものではありません。','発表主体と警報対象海域は同一とは限りません。']};});
 return{schemaVersion:1,stageOnly:true,publishable:false,complete,completenessScope:'transport-pages-only',consistencyVerified:false,semanticReady:false,fullWarningCoverage:false,featureCount,warningCount:items.length,pages:[...layers.values()],attribution:MSIL_ATTRIBUTION,constraintsUrl:MSIL_CONSTRAINTS,items};
}
// Candidate comparison only: never discard old-source records automatically.
export function overlapCandidates(staged,existing){
 return staged.items.map(item=>({identity:item.identity,candidates:existing.filter(n=>n.sourceCountry==='JP'&&new RegExp('(^|[^0-9])'+item.warningNumber.replace('-','[-/]')+'([^0-9]|$)').test(n.id+'\n'+n.text)).map(n=>({id:n.id,sourceId:n.sourceId||null,exactText:descriptionText(n.text)===item.text}))}));
}
