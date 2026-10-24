/**
 * Normalize typography only within a complete, degree-marked LAT/LON DMS pair.
 * No global HTML decoding, no stripping arbitrary controls, no coordinate inference.
 * Place before existing DMS tokenization; continue using the parser's numeric
 * range validation. This helper does NOT validate or repair numerical components.
 */
export function normalizeCoordinatePunctuation(text: string) {
  const deg = String.raw`(?:°|&deg;|&#0*176;|&#x0*b0;)`;
  const min = String.raw`(?:['′‘’\u0091\u0092]|&#0*(?:145|146|8216|8217|8242);|&#x0*(?:91|92|2018|2019|2032);)`;
  const sec = String.raw`(?:["″“”\u0093\u0094]|&#0*(?:147|148|8220|8221|8243);|&#x0*(?:93|94|201c|201d|2033);)`;
  const lat = String.raw`(\d{1,2})\s*${deg}\s*(\d{1,2})\s*${min}\s*(\d{1,2}(?:\.\d+)?)\s*${sec}\s*([NS])`;
  const lon = String.raw`(\d{1,3})\s*${deg}\s*(\d{1,2})\s*${min}\s*(\d{1,2}(?:\.\d+)?)\s*${sec}\s*([EW])`;
  const pair = new RegExp(String.raw`(^|[^\p{L}\p{N}])${lat}\s*,?\s*${lon}(?=$|[^\p{L}\p{N}])`, 'giu');
  return text.replace(pair, (whole, prefix, ld, lm, ls, lh, od, om, os, oh) => {
    if (!/[‘’′“”″\u0091-\u0094]|&(?:deg;|#)/iu.test(whole)) return whole;
    return `${prefix}${ld}°${lm}'${ls}"${lh.toUpperCase()} ${od}°${om}'${os}"${oh.toUpperCase()}`;
  });
}
