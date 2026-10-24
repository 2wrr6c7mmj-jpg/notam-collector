import {prepareMsil,pageState,descriptionText,geometryShapes} from './msil-stage.mjs';
import {warningIdentity,officialLinks} from './msil-evidence.mjs';
// Offline QA report. Rejected features are kept for inspection, never silently dropped for publication.
export function auditMsil(pages){
 const rejected=[],accepted=[];let sourceFeatureCount=0;
 for(const input of pages){pageState(input.page,input);const features=[];
  for(const [index,f]of input.page.features.entries()){sourceFeatureCount++;
   try{warningIdentity(f.properties.name,descriptionText(f.properties.description),officialLinks(f.properties.description));geometryShapes(f.geometry);features.push(f);}
   catch(e){rejected.push({layer:input.layer,index,name:f.properties?.name??null,reason:e.message,feature:structuredClone(f)});}
  }accepted.push({...input,page:{...input.page,features}});
 }
 // Reconciliation only; original page offsets/counts remain separately recorded in the QA report.
 let staged=null,batchError=null;try{staged=prepareMsil(accepted);}catch(e){batchError=e.message;}
 if(staged){staged.complete=false;staged.completenessScope='offline-accepted-subset-only';}
 return{stageOnly:true,publishable:false,sourceFeatureCount,acceptedFeatureCount:sourceFeatureCount-rejected.length,rejectedFeatureCount:rejected.length,rejected,staged,batchError};
}
