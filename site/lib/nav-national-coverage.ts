// UI-only metadata. Never add these blocked entries to fetchable navSources.
export const unconfiguredNationalNavCoverage = [
  {country:'RU',state:'unavailable',count:null,checkedAt:'2026-10-02T18:39:11Z',label:'ロシア極東・NAVAREA XIII',detail:'公式サイトへの接続を確認できません（HTTP 502）。警告の有無は不明です。',url:'https://mil.ru/activity/hydrographic/info/navwar',verificationUrl:'https://iho.int/uploads/user/Inter-Regional%20Coordination/WWNWS/WWNWS16/WWNWS16_2024_3.2-XIII_EN_Self%20Assessment%20NAVAREA%20XIII.pdf',evidence:'IHO掲載の担当国報告が公表元を確認。警報の現行本文・座標・日時は取得できず。'},
  {country:'KP',state:'unverified',count:null,checkedAt:'2026-10-02T18:52:00Z',label:'北朝鮮・国別の直接公表元',detail:'直接取得できる公式公開フィードは未確認です。警告の有無は不明です。NAVAREAの転載があっても国別の網羅を意味しません。',url:'https://iho.int/navigation-warnings-on-the-web',evidence:'IHOの地域公表元一覧を参照。北朝鮮の直接公開フィードの利用可能性を裏付ける現行ペイロードは未確認。不存在とは断定しない。'}
] as const;
