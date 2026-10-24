export const locationGroups = [
  { region: "日本", note: "福岡FIR、主要空港、基地周辺", codes: ["RJJJ","RJSM","RJCJ","RJTY","RJTA","RJOI","RODN","ROTM","ROAH","RJAH","RJST","RJTJ","RJNG","RJNK","RJNH","RJFY","RJFN","RJFZ","RJFA","RJOH","RJNA"] },
  { region: "中国", note: "主要FIR・管制区", codes: ["ZYSH","ZBPE","ZSHA","ZGZU","ZPKM","ZHWH","ZLHW","ZWUQ","ZJSA"] },
  { region: "台湾", note: "台北FIRと主要空港", codes: ["RCAA","RCPO","RCMQ","RCKU","RCSQ","RCNN","RCDC","RCSS","RCQS","RCYU","RCAY","RCQC"] },
  { region: "韓国", note: "仁川FIR、主要空港、基地周辺", codes: ["RKRR","RKSO","RKJK","RKSG","RKTI","RKTU","RKSW","RKTP","RKTY","RKSM","RKPE","RKTE","RKTN","RKNN"] },
  { region: "北朝鮮", note: "平壌FIRと主要地点", codes: ["ZKKP","ZKPY","ZKWS"] },
  { region: "フィリピン", note: "マニラFIRと主要空港", codes: ["RPHI","RPLC","RPLB","RPVP","RPVM","RPLS","RPMZ","RPML","RPMD","RPUT","RPUY","RPVI","RPMC"] },
  { region: "ロシア極東", note: "極東・東シベリアの主要FIRと空港", codes: ["UHHH","UHMM","UEEE","UIII","UHWW","UHSS","UHPP","UHMA"] },
] as const;

export const batchCodes: string[] = locationGroups.flatMap((group) => [...group.codes]);

export type CatalogEntry = [code: string, name: string];
