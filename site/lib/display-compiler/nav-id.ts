// Coastal broadcasts and inland bureaus use both slash and bracketed numbers.
export const warningNumber = /(?:黄海|安海|宜|泸|辽|津|冀|鲁|苏|沪|浙|闽|粤|深|桂|琼|黑|渝|鄂|汉|皖|赣|湘|云|滇|川|黔|甬|舟|温|连|烟|汕|湛|沪海)[\u4e00-\u9fff]{0,3}(?:航警|航通)\s*(?:\d+\s*\/\s*\d{2,4}|[（(〔\[【]\s*20\d{2}\s*[）)〕\]】]\s*\d+\s*号?)/;

export function canonicalWarningNumber(value:string) {
 const found=String(value||"").match(warningNumber)?.[0].replace(/\s/g,""); if(!found)return null;
 const slash=found.match(/^(.*?(?:航警|航通))(\d+)\/(\d{2,4})$/);
 if(slash)return `${slash[1]}${Number(slash[2])}/${slash[3].length===2?"20"+slash[3]:slash[3]}`;
 const bracket=found.match(/^(.*?(?:航警|航通))[（(〔\[【](20\d{2})[）)〕\]】](\d+)号?$/);
 return bracket?`${bracket[1]}${Number(bracket[3])}/${bracket[2]}`:found;
}
