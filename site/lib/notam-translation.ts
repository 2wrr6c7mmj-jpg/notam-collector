const replacements: Array<[RegExp, string]> = [
  [/UNMANNED AIRCRAFT SYSTEMS?/g, "無人航空機システム"],
  [/UNMANNED AIRCRAFT/g, "無人航空機"],
  [/REMOTELY PILOTED AIRCRAFT SYSTEMS?/g, "遠隔操縦航空機システム"],
  [/MISSILE FIRING/g, "ミサイル発射"],
  [/ROCKET (?:FIRING|LAUNCH)/g, "ロケット発射"],
  [/GUN FIRING|FIRING OF GUNS/g, "射撃"],
  [/MILITARY EXERCISES?/g, "軍事演習"],
  [/FORMATION FLIGHT/g, "編隊飛行"],
  [/TEMPORARY RESTRICTED AREA/g, "一時制限区域"],
  [/RESTRICTED AREAS?/g, "制限区域"],
  [/PROHIBITED AREAS?/g, "飛行禁止区域"],
  [/DANGER AREAS?/g, "危険区域"],
  [/AIRSPACE RESERVATION/g, "空域留保"],
  [/MILITARY OPERATING AREA/g, "軍事運用区域"],
  [/\b(?:AIRSPACE|AREA)\b/g, "空域"],
  [/BOUNDED BY/g, "次の点で囲まれる"],
  [/LINE JOINING/g, "次の点を結ぶ線"],
  [/WITHIN/g, "内側"],
  [/RADIUS/g, "半径"],
  [/\b(?:COUNTERCLOCKWISE|ANTI-CLOCKWISE)\b/g, "反時計回り"],
  [/\bCLOCKWISE\b/g, "時計回り"],
  [/EXCLUDING/g, "除く"],
  [/INCLUDING/g, "含む"],
  [/CLOSED|CLSD/g, "閉鎖"],
  [/\b(?:DEACTIVATED|INACTIVE)\b/g, "休止"],
  [/\b(?:ACTIVATED|ACTIVE)\b/g, "有効"],
  [/ACTIVITY/g, "活動"],
  [/EXERCISES?|EXER/g, "演習"],
  [/TRAINING/g, "訓練"],
  [/FLIGHT/g, "飛行"],
  [/\b(?:OPERATIONS?|OPS)\b/g, "運用"],
  [/SURFACE|\bSFC\b/g, "地表"],
  [/UNLIMITED|\bUNL\b/g, "上限なし"],
  [/ABOVE GROUND LEVEL|\bAGL\b/g, "対地高度"],
  [/ABOVE MEAN SEA LEVEL|\bAMSL\b/g, "平均海面高度"],
  [/\bFROM\b/g, "開始"],
  [/\bUNTIL\b/g, "終了"],
];

const fieldNames: Record<string, string> = {
  Q: "Q行", A: "対象地点", B: "開始時刻（UTC）", C: "終了時刻（UTC）",
  D: "実施時間帯", E: "内容", F: "下限高度", G: "上限高度",
};

export function translateNotam(text: string) {
  return text.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([QABCDEFG])\)\s*(.*)$/i);
    let body = match ? match[2] : line;
    for (const [pattern, replacement] of replacements) body = body.replace(pattern, replacement);
    return match ? `${fieldNames[match[1].toUpperCase()] || match[1]}: ${body}` : body;
  }).join("\n");
}
