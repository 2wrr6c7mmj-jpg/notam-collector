import type { ConciseBody } from './notam-concise';
// Matched against normalized E-body text, never NOTAM identifier.
export const reviewedBodies: ConciseBody[] = [
  {
    "title": "迎撃ミサイル発射に備えたVFR回避要請",
    "summary": [
      "迎撃ミサイルが発射される可能性があるため、那覇・宮古島・石垣島・与那国島の指定4空域をVFR機が飛行しないよう要請しています。"
    ],
    "conditions": [
      "政府機関の航空機・ドクターヘリ・自衛隊と事前調整済みの航空機は回避要請の対象外。",
      "指定空域を飛ぶVFR機は、各管制圏・情報圏内を除き、RODE RICK（123.1 / 138.05 MHz）への連絡を要請されています。"
    ],
    "where": "座標で囲む4空域。各都市・島の全域を示すものではありません。",
    "altitude": "地表・水面〜上限なし",
    "body": "ALL VFR ACFT ARE REQUESTED TO AVOID FLYING IN FOLLOWING AIRSPACE\r\nDUE TO THE ANTIBALLISTIC MISSILES MAY BE LAUNCHED\r\nFOR THE DESTRUCTION OF AN OBJECT PROPELLED BY ROCKET\r\nLAUNCHED FROM NORTH KOREA\r\n(1)AIRSPACE: BOUNDED BY FLW POINTS\r\n264419N1275729E - 255619N1275729E - 255619N1272129E - \r\n264419N1272129E - 264419N1275729E (NAHA-SHI)\r\n(2)AIRSPACE: BOUNDED BY FLW POINTS\r\n251802N1253730E - 243002N1253730E - 243002N1250130E - \r\n251802N1250130E - 251802N1253730E (MIYAKOJIMA)\r\n(3)AIRSPACE: BOUNDED BY FLW POINTS\r\n245604N1242912E - 240804N1242912E - 240804N1235321E - \r\n245604N1235321E - 245604N1242912E (ISHIGAKIJIMA)\r\n(4)AIRSPACE: BOUNDED BY FLW POINTS\r\n245838N1231516E - 241038N1231516E - 241038N1223916E - \r\n245838N1223916E - 245838N1231516E (YONAGUNIJIMA)\r\nRMK: 1)EXC ACFT OF GOVERNMENT AGENCIES,DOCTOR HEL AND\r\n  ACFT WITH PRIOR COORDINATION WITH JAPAN SELF DEFENSE FORCE.\r\n  MINISTRY OF DEFENSE JOINT STAFF OFFICE\r\n  TEL:03-3268-3111(EXT 30929)\r\n2)ALL VFR ACFT FLYING WI AIRSPACE(EXC EACH CTR AND INFO ZONE) ARE\r\n  REQUESTED TO CONTACT FLW FREQ\r\n  CALL SIGN : RODE RICK\r\n  FREQ      : 123.1MHZ,138.05MHZ",
    "sourceAltitude": {
      "F": "SFC",
      "G": "UNL"
    }
  },
  {
    "title": "迎撃ミサイル発射の可能性への注意",
    "summary": [
      "北朝鮮からのロケット発射に備え、迎撃ミサイルが発射される可能性があります。福岡FIRを飛行する全航空機に特別な注意を促しています。"
    ],
    "conditions": [],
    "where": "那覇・宮古島・石垣島・与那国島の配備位置4点。点を結ぶ区域ではありません。",
    "altitude": "地表・水面〜上限なし（F/G欄）",
    "body": "ALL ACFT INTENDING TO FLY WI FUKUOKA FIR ARE ADVISED TO PAY\r\nSPECIAL ATTENTION TO THE FOLLOWING INFORMATION.\r\nIN ACCORDANCE WITH ARTICLE 82-3 OF JAPAN SELF DEFENSE FORCE LAW,\r\nANTIBALLISTIC MISSILES MAY BE LAUNCHED FOR THE DESTRUCTION OF THE\r\nROCKET EXPECTED TO BE LAUNCHED FROM NORTH KOREA.\r\n\r\nTHE ANTIBALLISTIC MISSILES ARE DEPLOYED AT POSITIONS BLW,\r\n(1)NAHA-SHI     : 261219N1273929E\r\n(2)MIYAKOJIMA   : 244602N1251930E\r\n(3)ISHIGAKIJIMA : 242404N1241121E\r\n(4)YONAGUNIJIMA : 242638N1225716E",
    "sourceAltitude": {
      "F": "SFC",
      "G": "UNL"
    }
  },
  {
    "title": "気象観測気球の放球に注意",
    "summary": [
      "記載された8地点で気象観測気球が放球されます。飛行に注意してください。"
    ],
    "conditions": [],
    "where": "独立した放球位置8点。点を結ぶ区域ではありません。",
    "altitude": "最高82,021 ft（25,000 m）。高度の基準は本文に記載なし。",
    "timing": "現地時刻00:30〜23:59、120分との記載あり。",
    "uncertainty": "「120分」が各放球の時間を指すかなど、時間条件は確定できません。",
    "body": "USE CAUTION: WEATHER BALLOON LAUNCHES FOR 120 MINUTES FROM 0030L-2359L AT FOLLOWING COORDINATES: 26.64972222, 128.14611111//26.67888888, 128.09916666//26.64750000, 127.91638888//26.59083333, 127.99916666//26.49861111, 127.84416666//26.63555555, 128.03416666//26.54166666, 127.96722222//26.60583333, 128.02138888. MAX ALT: 82,021 FT (25,000M).",
    "sourceAltitude": {
      "F": "",
      "G": ""
    }
  },
  {
    "title": "航空灯火を点灯しない飛行訓練",
    "summary": [
      "宮城・山形県の指定区域で、UH1 2機とUH2 1機が航空灯火を点灯せずに飛行訓練を行います。"
    ],
    "conditions": [
      "RJSC情報圏を除外。目視気象状態（VMC）の場合のみ実施。"
    ],
    "where": "船形山周辺などの座標で囲む区域。記載市町村の全域ではありません。",
    "altitude": "地表・水面〜700 ft（平均海面基準）",
    "body": "UNLIGHTED ACFT FLT EXER:\r\n1. ACFT    : UH1 X 2 UH2 X 1\r\n2. AREA    : BOUNDED BY FLW POINTS\r\n385241N1403427E - 385124N1405751E - 382534N1405746E -\r\n381939N1405111E - 382118N1402555E - 383057N1402344E -\r\n382715N1401523E - 382633N1400943E - 383127N1400637E -\r\n383522N1400640E - 384427N1402430E - 384305N1403624E -\r\n385241N1403427E\r\n (EXC RJSC INFORMATION ZONE)\r\n (AROUND FUNAGATA-YAMA OUSANKEI)\r\n (SENDAI-SHI, KURIHARA-SHI, OSAKI-SHI, TOMIYA-SHI, KUROKAWA-GUN,\r\n  KAMI-GUN IN MIYAGI, YAMAGATA-SHI, SAGAE-SHI, MURAYAMA-SHI,\r\n  TENDO-SHI,  HIGASHINE-SHI, OBANAZAWA-SHI, NISHIMURAYAMA-GUN,\r\n  KITAMURAYAMA-GUN, MOGAMI-GUN IN YAMAGATA)\r\n3. WX COND : VMC ONLY\r\n4. RMK     : SOURCE/JSDF-G(RJSU)",
    "sourceAltitude": {
      "F": "SFC",
      "G": "700FT AMSL"
    }
  },
  {
    "title": "米軍活動によるIFR通過・経路制限",
    "summary": [
      "福岡FIR内の指定空域で米軍活動があり、非参加IFR機には空域を通過する管制許可が出ません。"
    ],
    "conditions": [
      "八戸・三沢管制圏と重なる空域を除外。境界の一部は海岸線です。",
      "V22・Y10・Y302の一部はFL310以下で影響を受け、指定代替経路での飛行計画提出が必要です（RJCC出発機を除く）。経路の並びは原文を確認してください。"
    ],
    "where": "座標と海岸線で囲む活動空域。",
    "altitude": "活動空域：5,000 ft（平均海面基準）〜FL300。経路への影響はFL310以下。",
    "body": "MULTIPLE U.S. MIL ACT WILL BE CONDUCTED WI FUKUOKA FIR AS FLW,\r\nAREA: BOUNDED BY FLW POINTS\r\n404510N1412502E - 404433N1421041E - 401210N1421347E - 400116N1415354E\r\nTO POINT OF ORIGIN, THE LINE CONNECTING POINT 400116N1415354E TO\r\n404510N1412502E IS ALONG THE COASTLINE.\r\nEXCLUDING THE OVERLAPPING AIRSPACE OF HACHINOHE AND MISAWA CTR.\r\nATC WILL NOT CLEAR NON-PARTICIPATING IFR FLT THRU THIS AREA.\r\nPORTION OF AWY V22, Y10 AND Y302 AFFECTED AT OR BLW FL310,\r\nREQ TO FILE ALTN AWY AS FLW EXC DEPARTURE ACFT FM RJCC.\r\n V22 - CHE V30 HWE V31 MRE V13 WAPPA HPE V33/V34\r\n Y10 - CHE Y12 HWE Y144 IWASE Y125 METEL Y102 SDE Y106 RUBIS\r\n Y302 - CHE Y12 HWE Y144 MAGGY Y32 YTE Y304 GUGBI Y30 SWAMP\r\nRMK: ATM CENTER TEL 81-92-608-8872",
    "sourceAltitude": {
      "F": "5000FT AMSL",
      "G": "FL300"
    }
  }
];
