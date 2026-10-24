import crypto from 'node:crypto';
// Literal activity schedule excerpts reviewed against all 245 saved originals.
// No timezone conversion, publication instant, or activity interval is inferred.
const reviewed={
 "日本航行警報:23-4041": {
  "sha256": "99d04182573780981b53ba5e5d348be0fb981cccf578a5b6b817aa8139591f34",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "NAVAREA航行警報:23-0435": {
  "sha256": "c935df8f32b06dcc379399ee06c80be329daba9f5ad9c8d7d096a4c0d4570179",
  "kind": "one-sided",
  "excerpts": [
   "UNTIL FURTHER NOTICE"
  ]
 },
 "日本航行警報:26-1490": {
  "sha256": "f52ff123f0419b6001a8398b09c23a8dc8cb463db7ad323c8283eb80ad897689",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3717": {
  "sha256": "f833929a8100c6ba068cafa4a604e6a76b5f5468c6250056324f9512b80e03c4",
  "kind": "one-sided",
  "excerpts": [
   "9月23日−当分の間"
  ]
 },
 "日本航行警報:26-3736": {
  "sha256": "dc85ff5ddc5bfadda0756a764f626fbd938b7e4fe941af5ba8b2fb1bd96a4205",
  "kind": "one-sided",
  "excerpts": [
   "10月8日まで"
  ]
 },
 "NAVAREA航行警報:26-0426": {
  "sha256": "6fcb8160c2b324f48661d64a65a396b95299a2bc6fe4d5c898c52b7ac01f3d5a",
  "kind": "one-sided",
  "excerpts": [
   "UNTIL 08 OCT 2026"
  ]
 },
 "NAVTEX航行警報:26-1832": {
  "sha256": "6183f39e2eef5131e8ead0838f01070759b044de74ddebff10415df003ed13a8",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "NAVAREA航行警報:26-0428": {
  "sha256": "3d709c01df2bceba9cae1ff1be5ead85d3646c8720648ff41eef5f0575d8b1c0",
  "kind": "one-sided",
  "excerpts": [
   "23 SEP TO UNTIL \nFURTHER NOTICE"
  ]
 },
 "日本航行警報:26-3866": {
  "sha256": "2ec96bd42c242c99b3d694e0e8f2514c79867100d981621e887bfbf89dfe42f9",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "NAVAREA航行警報:26-0438": {
  "sha256": "5d6172b55b1bcb24cc02be30dc6582f02bab96528501f35bee9c2f0918be0f09",
  "kind": "one-sided",
  "excerpts": [
   "UNTIL FURTHER NOTICE"
  ]
 },
 "日本航行警報:26-3874": {
  "sha256": "ab930d14728d2b96d793ea2f513c4eba34e0c8e1d58f11ff2ec0e5c869be7fc5",
  "kind": "bounded",
  "excerpts": [
   "PLATINUM EXPLORERによる掘削作業、10月2日−11月13日まで"
  ]
 },
 "日本航行警報:26-2084": {
  "sha256": "92453b527284711183b453f39f4a99f9fc6b3a0ded68803f15245b3036fe4a92",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-2588": {
  "sha256": "3c99c6408206262faa17641a593baa0a2abf22bf38d02a837883464676020673",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3333": {
  "sha256": "ca92e3633da7b78dc3372b4fd3a4c9b56cad9b571e5528111f804aa4fbadef50",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3334": {
  "sha256": "914db336f7473d96e7ba6d531e8620db1a25f7d5558337e2ff1f1e20abafb9b9",
  "kind": "one-sided",
  "excerpts": [
   "12月15日まで"
  ]
 },
 "日本航行警報:26-3469": {
  "sha256": "f571c4c034028c6acdda67192054e62acb34363e7980b848e822cfa3214b32fd",
  "kind": "bounded",
  "excerpts": [
   "M／V REBECCAによる海底線作業、9月4日−10月5日"
  ]
 },
 "日本航行警報:26-3651": {
  "sha256": "644cc7877637501e73569ff885b128b8872e64aefe71ad4b5f4f6da7b8bf1e86",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3669": {
  "sha256": "535a52106c2a4180cdab0f6981af650f4d2c928fcd6f71c6c7ecef633e8800d8",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "NAVTEX航行警報:26-1828": {
  "sha256": "d254054fd6b9dac1a89a9286859dceb0aa794fe7359fbdac86b65dc3b8df299e",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3809": {
  "sha256": "155e38bcf279b6a198fafdd09c7f07ea2c1eab65608aba2a3e9bd8f8ae1cfcec",
  "kind": "one-sided",
  "excerpts": [
   "9月26日−当分の間"
  ]
 },
 "日本航行警報:26-3808": {
  "sha256": "87e60960acceffdd92a96ca1fef42dc4fb2151b982cddd4b7e8481f46b76748a",
  "kind": "one-sided",
  "excerpts": [
   "9月26日2300Z\n−当分の間"
  ]
 },
 "NAVAREA航行警報:26-0433": {
  "sha256": "e7a98999d8d2473b62c5d3b974b9f79d6c31baa4f75a624adefee6036175ce2e",
  "kind": "one-sided",
  "excerpts": [
   "UNTIL FURTHER\nNOTICE"
  ]
 },
 "日本航行警報:26-3848": {
  "sha256": "bfd161b429b1938a0ac45dcdf736bc1f748cbe22dd75e85635f615dc90af2d4a",
  "kind": "bounded",
  "excerpts": [
   "M／V GRACEによる海底線作業、10月1日0500Z−10日1900Z"
  ]
 },
 "日本航行警報:26-3872": {
  "sha256": "3ba3eb97a6dd2a682a9f219e76a93e6a10b5fc26c97f65fd490b352a993f992d",
  "kind": "one-sided",
  "excerpts": [
   "11月13日まで"
  ]
 },
 "日本航行警報:26-3871": {
  "sha256": "bdd024e2f2742bfe4b47be582c39def2b2dc673b43d050fe58efd13fbc5d801e",
  "kind": "bounded",
  "excerpts": [
   "宇宙ゴミ落下、10月5日−19日毎日1050Z−翌日0030Z"
  ]
 },
 "日本航行警報:26-3880": {
  "sha256": "22b30c31de8ab49b20d2492ca3354d2e3453515dcbf4df5a41645cb5ab86c9d0",
  "kind": "bounded",
  "excerpts": [
   "ミサイル射撃、10月5日−15日毎日1400Z−翌日0900Z"
  ]
 },
 "日本航行警報:26-3860": {
  "sha256": "f77e13956fa404a4b788e8c5359b1d8b06594fd425b171d1f0077e61df5ec9a0",
  "kind": "bounded",
  "excerpts": [
   "（1）10月5日0806Z−0852Z（予備6日0759Z−0845Z、\n 7日0751Z−0837Z、8日0744Z−0830Z、\n 9日0736Z−0822Z、10日0729Z−0815Z\n 11日0721Z−0807Z）",
   "（2）10月5日0806Z−0911Z（予備6日0759Z−0904Z、\n 7日0751Z−0856Z、8日0744Z−0849Z、\n 9日0736Z−0826Z、10日0729Z−0834Z\n 11日0721Z−0807Z）"
  ]
 },
 "NAVTEX航行警報:26-1882": {
  "sha256": "d27bfa09333d70ec821692c18ef2c2dfa892cd2d10176b24366c1e18c1f420d6",
  "kind": "bounded",
  "excerpts": [
   "10月7日（予備8日−14日）1228−1343"
  ]
 },
 "日本航行警報:26-3885": {
  "sha256": "9fea45e843f7cef949ddb05a0d03862e68d500ed444fa6be6f7a3d2b3101c70b",
  "kind": "bounded",
  "excerpts": [
   "10月7日（予備8日−14日）1228−1343",
   "10月7日（予備8日−14日）0333Z−0453Z"
  ]
 },
 "NAVAREA航行警報:26-0439": {
  "sha256": "cc68b6c42ef1d1099fe715239dbdb5da000d1ac9bc4cb1da3b67369b8bcfd9f7",
  "kind": "bounded",
  "excerpts": [
   "070333Z TO 070453Z OCT"
  ]
 },
 "日本航行警報:26-3909": {
  "sha256": "7e88564e6413ec02a7fd89dd1df1303b349678377ed03bc42a16c9309b7c822b",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月8日0600Z−0900Z、9日0000Z−0900Z"
  ]
 },
 "日本航行警報:26-3787": {
  "sha256": "a6ed6b445722b84ea357e29059decaac0ff2d2e6af91313dd48e2d4781ce8d4f",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月1日−31日毎日0800−1800"
  ]
 },
 "NAVAREA航行警報:26-0430": {
  "sha256": "eb327474b6e7dab5d9f3594116ce98e8c2fd927ce074d941a3875df738f9a018",
  "kind": "bounded",
  "excerpts": [
   "GUNNERY. 2300Z TO 0900Z COMMENCING DAILY\n30 SEP TO 30 OCT. AREA BOUNDED BY"
  ]
 },
 "NAVTEX航行警報:26-1844": {
  "sha256": "e3775e66f57119605776cd3317d21fdfab7a4e49369acf7d3dde0cafd1d5bb41",
  "kind": "bounded",
  "excerpts": [
   "ミサイル射撃、10月1日−31日毎日0700−1900"
  ]
 },
 "日本航行警報:26-3782": {
  "sha256": "0358d7434ddd42cfae690cbdc03ad8c2c66383f0e46796933ed7c34f98777a94",
  "kind": "bounded",
  "excerpts": [
   "ミサイル射撃、10月1日−31日毎日0700−1900"
  ]
 },
 "NAVAREA航行警報:26-0034": {
  "sha256": "e24d854d4f8c44dbd50b217f382a00c5fe7216c4fff8a7ce927dd9d87304466f",
  "kind": "one-sided",
  "excerpts": [
   "UNTIL FURTHER NOTICE"
  ]
 },
 "日本航行警報:26-0301": {
  "sha256": "5b218264126cde0e0345ee64963dd666c6fd3581d4409061ca15d0c7df4faa49",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3912": {
  "sha256": "54396814cc16cbbfa6b888ba4015d3a033a86ec52c17523fa97b5a1d2b8ccfa8",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日1330Z−9日1530Z"
  ]
 },
 "日本航行警報:26-3910": {
  "sha256": "f935d360bd9712efa9e03513b2380ecc9df0e896087e7fcbd952a039df58c643",
  "kind": "bounded",
  "excerpts": [
   "危険な訓練、10月6日1800Z−2300Z"
  ]
 },
 "日本航行警報:26-3911": {
  "sha256": "3cba1b9f82d7ab6a203fafaa47ed317305722a80aaf5631efac5e6bbab4029e8",
  "kind": "bounded",
  "excerpts": [
   "危険な訓練、10月7日1730Z−翌日0100Z（予備8日1400Z−2000Z、\n9日1730Z−翌日0100Z）"
  ]
 },
 "NAVTEX航行警報:26-1847": {
  "sha256": "f06124acef4499637a469f0ea2647449ad8c09a8a9c57a81909d1010c5ace0e8",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月1日−31日毎日1100−2300"
  ]
 },
 "日本航行警報:26-3791": {
  "sha256": "e0f1157865f31969cd2338e9ce0edae0c9d9ef729513ec2bab7b2d78428bd001",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月1日−31日毎日1100−2300"
  ]
 },
 "日本航行警報:26-3806": {
  "sha256": "80e104b790a1951db10e54171d67df42abd16fd678e6860bf66a49d9b0ea5f0f",
  "kind": "bounded",
  "excerpts": [
   "危険な訓練、10月1日0800Z−11月1日0800Z"
  ]
 },
 "日本航行警報:26-3085": {
  "sha256": "aafec551fb384dde3a8270f2ff42098285754057ed5e8c4c97de74fac6b78421",
  "kind": "one-sided",
  "excerpts": [
   "12月31日まで"
  ]
 },
 "NAVAREA航行警報:26-0356": {
  "sha256": "8e8a60e9a35320335ccbc60369a576b4ba7bf1fce051832b493cdf8f667283f1",
  "kind": "one-sided",
  "excerpts": [
   "UNTIL 31 DEC 2026"
  ]
 },
 "NAVTEX航行警報:26-1866": {
  "sha256": "713c063913469ba4bb3795297f0a4f59b154c6c2e39e3a8cae85000b2624cfa0",
  "kind": "bounded",
  "excerpts": [
   "9月30日−10月11日毎日0600−2400"
  ]
 },
 "日本航行警報:26-3856": {
  "sha256": "0840a76fb1796e4e4d00a4776092a7025ca24134838d4524565088e020ae503a",
  "kind": "bounded",
  "excerpts": [
   "9月30日−10月11日毎日0600−2400"
  ]
 },
 "日本航行警報:26-3801": {
  "sha256": "1be4da25c0f8b285608d6670222fba85320a98fb829e53467514df2fe128e0c9",
  "kind": "bounded",
  "excerpts": [
   "射撃、9月30日、10月1日、4日−7日、11日−15日、18日−22日、\n26日−29日毎日2300Z−翌日1000Z"
  ]
 },
 "NAVTEX航行警報:26-1848": {
  "sha256": "50baebf768aba77dc18f1ab4309c79a1326b47ad1d51fa8ba4435783c727b719",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日−31日毎日0600−1800"
  ]
 },
 "日本航行警報:26-3792": {
  "sha256": "5b9a1ad44b64f966c7a508dd70d386806f780c07c880489f29a9eca158dc3fba",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日−31日毎日0600−1800"
  ]
 },
 "日本航行警報:26-3800": {
  "sha256": "ca93636e916c0a5f50b48b9efe66204854a904b64dd25e3d7a707718301c48c6",
  "kind": "bounded",
  "excerpts": [
   "射撃、9月30日、10月1日、4日−7日、11日−15日、18日−22日、\n26日−29日毎日2300Z−翌日0830Z"
  ]
 },
 "日本航行警報:26-3805": {
  "sha256": "1a8725edc000e45aaad600e673cc0574543e7904e9aea6c8f4784faea844db65",
  "kind": "bounded",
  "excerpts": [
   "危険な訓練、10月1日0800Z−11月1日0800Z"
  ]
 },
 "NAVTEX航行警報:26-1887": {
  "sha256": "d5bf5e453ad957022a911230207bf950c164d64769a3b7818b966512602c7840",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日、8日毎日0900−1800"
  ]
 },
 "日本航行警報:26-3889": {
  "sha256": "fdb9cdf306ea8be05fafdffe193703171a51ed5e71a19b5c294a3a473bd978e2",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日、8日毎日0000Z−0900Z"
  ]
 },
 "日本航行警報:26-1963": {
  "sha256": "1e235de50a73f063f182eecd7e2f83345dfbce6cd782881e0a5f34c4d8a46326",
  "kind": "bounded",
  "excerpts": [
   "水中作業、5月25日−12月31日まで"
  ]
 },
 "日本航行警報:26-3796": {
  "sha256": "039cada5538ef09d300ea9e4245a15305fb9185ebfdef322e18076ac6a655261",
  "kind": "bounded",
  "excerpts": [
   "射撃、9月30日、10月1日、4日−7日、11日−15日、18日−22日、\n26日−29日毎日2300Z−翌日0500Z、1日−2日、5日−8日、\n12日−16日、19日−23日、27日−30日毎日0600Z−0900Z"
  ]
 },
 "NAVTEX航行警報:26-1857": {
  "sha256": "c2d17bfd781aa47d9e0b21b1cb5d827381db793bfe62d0e988b09799aca31c2a",
  "kind": "bounded",
  "excerpts": [
   "ロケット射撃、10月3日、5日（予備4日、6日−9日）\n毎日0700−2100"
  ]
 },
 "日本航行警報:26-3820": {
  "sha256": "72fa0492a94191881cb7970eb04949c89b6584af7a6d5edde201279d8f56c4ce",
  "kind": "bounded",
  "excerpts": [
   "ロケット射撃、10月3日、5日（予備4日、6日−9日）毎日0700−2100"
  ]
 },
 "NAVTEX航行警報:26-1876": {
  "sha256": "64f1c06d8d702f0b91c12f800e77a03f29d8ab1b82d85a130524207f969281db",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日（予備7日）0800−1800"
  ]
 },
 "日本航行警報:26-3864": {
  "sha256": "c1439e107cddad735ac5d42ab4319b187a80710463c5cd0d3e4a4af88b50221e",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日（予備7日）0800−1800"
  ]
 },
 "日本航行警報:26-3824": {
  "sha256": "6627a05c80220f297414ecd63155c5a971d258b95f086c252e04ac4cbb09c579",
  "kind": "one-sided",
  "excerpts": [
   "11月9日まで"
  ]
 },
 "日本航行警報:26-3891": {
  "sha256": "7fc160f2817a3331e740af6b3050791eb78559e3be225427f75588d06a00fd7b",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日0400Z−1100Z、6日−8日毎日0000Z−0900Z"
  ]
 },
 "NAVTEX航行警報:26-1845": {
  "sha256": "d9e30ab9713e0e01ed44a0863ccea22e661849a4178c2eaa0864ad4fde913088",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日、2日、5日−9日、13日−16日、19日−\n23日、26日−30日毎日0800−1700"
  ]
 },
 "日本航行警報:26-3788": {
  "sha256": "35ac41556ad07f01364c3ca7955ec2a732d22577c7ac6d8876b3444205fb8e47",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日、2日、5日−9日、13日−16日、19日−23日、26日−30日\n毎日0800−1700"
  ]
 },
 "NAVTEX航行警報:26-1843": {
  "sha256": "d171db663793a8ed30562b3f5041797599a8471ae7c846c1bc38a50430152df4",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日−3日、5日−10日、13日−17日、\n19日−24日、26日−31日毎日0700−1700"
  ]
 },
 "日本航行警報:26-3786": {
  "sha256": "6ae75dda15f19db18be83cacb2f834f6a02829fd6bb7e672ae57ec1a59a84883",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日−3日、5日−10日、13日−17日、19日−24日、26日−\n31日毎日0700−1700"
  ]
 },
 "三管区地域航行警報:03-260371": {
  "sha256": "be3a4d382f2fe83470e51267eb4eac74d2e147aa66bfc7fcefdfb315b3bb793b",
  "kind": "bounded",
  "excerpts": [
   "10月1日～31日（日曜日及び祝日を除く）0700～1700まで"
  ]
 },
 "NAVTEX航行警報:26-1886": {
  "sha256": "aef329fba725c7e1bbfd3d73eceae6c1c9dab0cbfaec87aee458e051e22e3d4b",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日1400−2000、6日0800−2000、\n7日、8日毎日0800−1800"
  ]
 },
 "日本航行警報:26-3888": {
  "sha256": "19e9a71f1ef96847d139cc7a3fdd975534daa270a19f2204b191aa63add56d50",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日0500Z−1100Z、2300Z−翌日1100Z、\n6日、7日毎日2300Z−翌日0900Z"
  ]
 },
 "日本航行警報:26-3895": {
  "sha256": "b23f28371129185c11f047f7f5753eea0c2403e5ef79d814773233eb87e73e88",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日0000Z−0700Z、6日、7日毎日2300Z−翌日0900Z、\n10日、11日毎日0400Z−0800Z"
  ]
 },
 "NAVTEX航行警報:26-1846": {
  "sha256": "ae3194e6a3c174471f8900678e3801a55efe124527689e861a77e93c71fdf2d7",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日、2日、5日−9日、13日−16日、19日−\n23日、26日−30日毎日0800−1700"
  ]
 },
 "日本航行警報:26-3789": {
  "sha256": "4a97dd5e84b52a5119f9a2448548e6120119fb910c076ec799846bfcba4ce893",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日、2日、5日−9日、13日−16日、19日−23日、26日−30日\n毎日0800−1700"
  ]
 },
 "NAVTEX航行警報:26-1868": {
  "sha256": "717af705d2c7608bee719e0b743b3129cd21d2994c3f6e50d58fe7761fa325d3",
  "kind": "bounded",
  "excerpts": [
   "射撃及びフレア発射、10月5日−7日（予備8日、9日）毎日\n0800−1700"
  ]
 },
 "日本航行警報:26-3854": {
  "sha256": "ea524d6ec7a4028201fdd5c01c0f8a07255854223f0e585dc56ac554420a27e0",
  "kind": "bounded",
  "excerpts": [
   "射撃及びフレア発射、10月5日−7日（予備8日、9日）毎日0800−1700"
  ]
 },
 "日本航行警報:26-3873": {
  "sha256": "e9e848221a4ea113395b7e95b7ac29a4828153f4bcef211c3884ccb89cd5c9b5",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日−10日毎日0130Z−1430Z"
  ]
 },
 "NAVTEX航行警報:26-1840": {
  "sha256": "c5ec0b885fb1633ae3c39c6c56b6855c7ff389745ecd31597759204d6f29a6b9",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日−3日、5日−10日、13日−17日、\n19日−24日、26日−31日毎日0800−1700"
  ]
 },
 "日本航行警報:26-3785": {
  "sha256": "64df5ce0aed6e7b848825ecaf45e150fe9da1a48e77db7b19b14dc2e0469f4aa",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日−3日、5日−10日、13日−17日、19日−24日、26日−\n31日毎日0800−1700"
  ]
 },
 "NAVTEX航行警報:26-1842": {
  "sha256": "6c38bd64201abd3cc5c9cd3f7977ae129aa2be9804ed1cd1a5a11d1ba3b2aeef",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日、2日、5日−9日、13日−16日、19日−\n23日、26日−30日毎日0800−1700"
  ]
 },
 "日本航行警報:26-3781": {
  "sha256": "1fc00d0e0744de4f48ea328677807839eaaf127271be233c9fb01df7d920864d",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日、2日、5日−9日、13日−16日、19日−23日、26日−30日\n毎日0800−1700"
  ]
 },
 "日本航行警報:26-3881": {
  "sha256": "3a20f55f9d85a64a85358ef727ea5a602f531c4604b919be3646e905e63061cd",
  "kind": "bounded",
  "excerpts": [
   "危険な訓練、10月6日2000Z−2300Z"
  ]
 },
 "日本航行警報:26-3900": {
  "sha256": "2d3616256a42a74844536a8e2aac96f292d44679387b12fe8032fb8677475b33",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月4日−7日毎日2300Z−翌日0900Z"
  ]
 },
 "NAVTEX航行警報:26-1851": {
  "sha256": "8e83d40e8e2c8b045b546b0cc8354e1b3157fbe187d319e184d24082f40918ea",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月1日、2日、5日−8日、12日−16日、\n19日−23日、27日−30日毎日0800−1800"
  ]
 },
 "日本航行警報:26-3795": {
  "sha256": "0f61a6d98016e3c43bb296ca7f85d5f8aa3d7c7775c304a239380e231345bc09",
  "kind": "bounded",
  "excerpts": [
   "射撃、9月30日、10月1日、4日−7日、11日−15日、18日−22日、\n26日−29日毎日2300Z−翌日0900Z"
  ]
 },
 "日本航行警報:26-3892": {
  "sha256": "b4727f1b450fb822861e743470a00f065a06d6f38cce9dd6c09e646303cb4950",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日−7日2300Z−翌日0900Z"
  ]
 },
 "日本航行警報:26-3887": {
  "sha256": "8e32dfb9361481ebbd02b57dcfb8cc0b620674997cd0f70c8874f2b0fa97203f",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日0200Z−0400Z、9日、10日毎日0400Z−0600Z"
  ]
 },
 "日本航行警報:26-3917": {
  "sha256": "242958497767ff0ff24f5c476a0ff62a4402a1ed4da043be8cb7bb3cb78bf7e5",
  "kind": "bounded",
  "excerpts": [
   "危険な訓練、10月9日（予備10日）0600Z−1242Z"
  ]
 },
 "NAVAREA航行警報:26-0444": {
  "sha256": "aba06e1c5fcb5d857ee67a2481da4b7f8ceea21a380a8636b99da0f0f2d44866",
  "kind": "bounded",
  "excerpts": [
   "HAZARDOUS OPERATION. 090600Z TO 091242Z",
   "OCT, ALTERNATE 100600Z TO 101242Z OCT."
  ]
 },
 "日本航行警報:26-3922": {
  "sha256": "e7435b8b917dbed25df93cd6d85541ce397d9d635fb501139d29e6f0488b5870",
  "kind": "bounded",
  "excerpts": [
   "宇宙ゴミ落下、10月9日1700Z−2300Z"
  ]
 },
 "日本航行警報:26-3797": {
  "sha256": "e073800aecb6b97a3d23361c93b1210277c11b8ebab3c8cce7ac6a6e25ef6897",
  "kind": "bounded",
  "excerpts": [
   "射撃10月1日、2日、5日−8日、12日−16日、19日−23日、27日−30日\n毎日0000Z−0900Z"
  ]
 },
 "日本航行警報:26-3893": {
  "sha256": "2390c1cae9df2b22a4652c274fb80d22e4ddc99137fbee79cac34a744dfd8c0f",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日、7日毎日2300Z−翌日0800Z"
  ]
 },
 "日本航行警報:26-3890": {
  "sha256": "82b8475e6661a3aefa05d7ac70cd997627c89657cf1b9990e92cecadb47f7071",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日、8日毎日0000Z−1300Z、7日0000Z−0800Z、\n11日0130Z−0330Z"
  ]
 },
 "日本航行警報:26-3798": {
  "sha256": "f230e88cbfb38080db24a50b324a168a4d5cd408f8102d65d58fc84f64fe49e8",
  "kind": "bounded",
  "excerpts": [
   "射撃、9月30日、10月1日、4日−7日、11日−15日、18日−22日、\n26日−29日毎日2300Z−翌日0900Z"
  ]
 },
 "日本航行警報:26-3896": {
  "sha256": "25608a5cf7419e6ffb4d862730bd6f84812738b973c3568ede2b38a52d25027e",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日、7日毎日2300Z−翌日0900Z"
  ]
 },
 "NAVTEX航行警報:26-1885": {
  "sha256": "35dbefbb31c8c0984209b4c6bd6f4a111fa949ff9a175112fa34d009e90732d5",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日、8日毎日0900−2200、\n7日0900−1700"
  ]
 },
 "日本航行警報:26-3886": {
  "sha256": "d16dcd16def3bca10547d33065022616d6da984414c9c81eb9f48764535e8010",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日、8日毎日0000Z−1300Z、7日0000Z−0800Z"
  ]
 },
 "日本航行警報:26-3875": {
  "sha256": "b3a8e36d90d09f07269e59c24340a4d7719caf969b4ea951498e4306238e4fc3",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日−7日毎日0230Z−1130Z"
  ]
 },
 "NAVTEX航行警報:26-1841": {
  "sha256": "6dd099df39bd52899c109a8d601e71ff34a951a96cc17b3109fb104bf2f848f9",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月1日−31日毎日0800−1900"
  ]
 },
 "日本航行警報:26-3783": {
  "sha256": "4ff3e4ea38fa568b4aea30030ed2164cea9b70a5acbc0be5dd9bbcd44a3bfa28",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月1日−31日毎日0800−1900"
  ]
 },
 "三管区地域航行警報:03-260366": {
  "sha256": "68bff4d53e5fe7d5fdb0889eecf825b0186f4705c56bc6e8c99b12ac1f359115",
  "kind": "bounded",
  "excerpts": [
   "9月28日～11月26日の0530～1700まで"
  ]
 },
 "NAVTEX航行警報:26-1821": {
  "sha256": "21b94c51e94adfe88be627b4ec1c67a470211ac02e5d770312eaeec65747342a",
  "kind": "bounded",
  "excerpts": [
   "飛しょう体発射、9月28日−11月26日毎日0530−\n1700"
  ]
 },
 "日本航行警報:26-3730": {
  "sha256": "3e682cf7b3c96e58d446213ba90a531eb5bf77d2f4c5fa99e304acf79794dffd",
  "kind": "bounded",
  "excerpts": [
   "飛しょう体発射、9月28日−11月26日毎日0530−1700"
  ]
 },
 "NAVTEX航行警報:26-1883": {
  "sha256": "2b5bb6bcc804d1e4fb9f1e73992887f1470aaf8548dff5ae007cb33e26fa39d4",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日（予備8日）0900−2400"
  ]
 },
 "日本航行警報:26-3877": {
  "sha256": "87c86c0aefbf09f803a4de0fe849401807612245d275261a94fa799ed553f46f",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日（予備8日）0900−2400"
  ]
 },
 "日本航行警報:26-3899": {
  "sha256": "2077f549b9cdfe5d9b2f0eb76423e18368076f1431a0d4ce574da92aeb4e044c",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日0500Z−0800Z、6日0800Z−1100Z"
  ]
 },
 "日本航行警報:26-3145": {
  "sha256": "7150791b9b55233f9215caf3484314fd4c5029833d56c71f1b417789aa9b4c28",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3916": {
  "sha256": "20310d806164ef7a85b6e6826915a166ffb92f1d7f9889cacf7465878c1178aa",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月9日−11日毎日0300Z−1200Z"
  ]
 },
 "日本航行警報:26-3850": {
  "sha256": "e5f075e9b8a33e90065ef211acf88ccc9bd567a04293d4425499e885dda0d748",
  "kind": "bounded",
  "excerpts": [
   "危険な訓練、10月1日−30日（土曜日と日曜日を除く。）\n毎日0300Z−1900Z"
  ]
 },
 "NAVTEX航行警報:26-1881": {
  "sha256": "f763214a2de2a59a54131de15ad14d91563ef50f9a5db422c914c65bfb35b581",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日0900−2400"
  ]
 },
 "日本航行警報:26-3876": {
  "sha256": "37653d68e4d382a1d096d292bef18cdfee5f8533c313c16d669e3a9b2f705e1e",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日0900−2400"
  ]
 },
 "NAVTEX航行警報:26-1884": {
  "sha256": "f9de3b9f95f165e9f7f1ea653f7f01c897eadc67543a78523c403ea75200ef0a",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日0800−翌日2400"
  ]
 },
 "日本航行警報:26-3879": {
  "sha256": "c62aa9f69206616cf4ecc9345297d4ae06bbd742eae7fe7eb796670bc919b746",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日0800−翌日2400"
  ]
 },
 "NAVTEX航行警報:26-1893": {
  "sha256": "8a4ef2e5aac27f9c2e500c6b31ca94411d07431ba628932cdf105dfa403a7f24",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月10日（予備12日）0800−翌日2400"
  ]
 },
 "日本航行警報:26-3920": {
  "sha256": "4f0371b7989e74479f0821222a1e67ace7f206d73a69e35f68e8d3fc8e222640",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月10日（予備12日）0800−翌日2400"
  ]
 },
 "NAVTEX航行警報:26-1869": {
  "sha256": "59754110fcdd489bf13bd17ffd4ba404e45d5f2e8120ab32d2fcd5c3ca458112",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日−7日（予備8日、9日）毎日0800−\n1800"
  ]
 },
 "日本航行警報:26-3855": {
  "sha256": "91babf4c419f5b84debd7ff848b60ad26ea3717f25de61e3b52558cbcbe236f4",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日−7日（予備8日、9日）毎日0800−1800"
  ]
 },
 "日本航行警報:26-3799": {
  "sha256": "ffdcfc2f94216c5fee5d2bf1efec04d6911c87a613e633c683297fa1d9113cbd",
  "kind": "bounded",
  "excerpts": [
   "射撃、9月30日、10月1日、4日−7日、11日−15日、18日−22日、\n26日−29日毎日2300Z−翌日0900Z"
  ]
 },
 "七管区地域航行警報:07-260245": {
  "sha256": "932fc7cfa609c6cfaeb8c0bb88bf3ec07430061cb6cd594815f741cff86ab05b",
  "kind": "bounded",
  "excerpts": [
   "期間は、10月5日から7日（予備日8日、9日）の毎日0800から1800で"
  ]
 },
 "日本航行警報:26-3898": {
  "sha256": "9ee8e555ac53a659cb43d825536fb47a6ff5d7cbdeb131ad9551f3bf0bc2633b",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日、6日毎日0000Z−1200Z、6日2100Z−翌日1200Z、\n8日、9日毎日0600−1200Z、10日0000Z−0900Z、2100Z−\n翌日0900Z"
  ]
 },
 "日本航行警報:26-3897": {
  "sha256": "8edf4a418e93453addbffd417d188aabe77548d0472146a7a8ddf14553762597",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月4日1500Z−翌日1459Z、5日2300Z−翌日1400Z、\n7日−10日毎日0000Z−1400Z、2100Z−翌日1400Z"
  ]
 },
 "日本航行警報:26-3902": {
  "sha256": "193a89d53867351fdca948ffa187b4f8281b5e76e2e755cf5c86095eb25cb6a0",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日−7日毎日0100Z−1000Z、\n8日−11日毎日0100Z−1100Z"
  ]
 },
 "日本航行警報:26-3849": {
  "sha256": "0371fba2d87a2ca5cd08f59c0bac19b473d9b9c8ee70d5178d47cfb430f15fb6",
  "kind": "one-sided",
  "excerpts": [
   "11月13日まで"
  ]
 },
 "日本航行警報:26-3865": {
  "sha256": "2ef510851582cc43e5476b7a6616d5b87d714c9dd17c04cc55dce34bc923e725",
  "kind": "bounded",
  "excerpts": [
   "危険な訓練、10月6日−8日毎日0100Z−1300Z"
  ]
 },
 "日本航行警報:26-1241": {
  "sha256": "765fc04e50de6a1d2c2a4625557200cd2b6891adc878533d4096047c747c16de",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3913": {
  "sha256": "0067be444eac222e78907c8c5a3b87505938098d80ecd135fbca9f2144e4576a",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月5日0830Z−1130Z"
  ]
 },
 "日本航行警報:26-3914": {
  "sha256": "3d67e0e56e4e7a0d3fc28434def15450a0400d1cfeb6cc843b51ba0f9dc72caa",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月7日1130Z−1530Z"
  ]
 },
 "NAVTEX航行警報:26-1839": {
  "sha256": "7ba254fda0e7a2a38b3c4f1456c039c4ea0978eab8158a4bcd685269ff7839c5",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日−31日毎日0700−2000"
  ]
 },
 "日本航行警報:26-3784": {
  "sha256": "2dd699425b8fde57c38c7e61ec87062d9ec1f694abe1039c51c9b99680be2985",
  "kind": "bounded",
  "excerpts": [
   "爆撃、10月1日−31日毎日0700−2000"
  ]
 },
 "日本航行警報:26-3894": {
  "sha256": "b7fc2816f2e479700b44bd380e1b9fea65977223f66bcd01b7ea4332fe7b4c77",
  "kind": "bounded",
  "excerpts": [
   "射撃、10月6日、8日毎日1000Z−1400Z"
  ]
 },
 "日本航行警報:26-3670": {
  "sha256": "3e14d400833442c83d2f8486fd293a79c8a1e796d68ac8a7c4d092c9a139900c",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:26-3144": {
  "sha256": "91a5e1038c2d0d868ba9a051e2878d8510ee0b23e6e52bce191d8ee47a87a33e",
  "kind": "one-sided",
  "excerpts": [
   "11月10日まで"
  ]
 },
 "日本航行警報:26-3235": {
  "sha256": "cfa28fb993665fe63ddc0d57dc797d56277dd7aaacca49bc19980c692ee18a41",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "三管区地域航行警報:03-260376": {
  "sha256": "389df9a754f99dbc60512889b497dfd09ea88eee3021b7bbe7c8d761a5e6156a",
  "kind": "bounded",
  "excerpts": [
   "10月5日～8日の1730～2100、自衛隊潜水士による潜水訓練が実施されます。"
  ]
 },
 "日本航行警報:25-2049": {
  "sha256": "f66408286a3daadd4b808a294fb491b4c68ce21c97e7762647a03b058396a5e6",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 },
 "日本航行警報:25-2161": {
  "sha256": "f396301b6c8106d6d3a578271d562fe93c6168c7caec88a5604a19c25c491321",
  "kind": "one-sided",
  "excerpts": [
   "当分の間"
  ]
 }
};
export function msilSourceSchedule(item){const r=reviewed[item.identity];if(!r||crypto.createHash('sha256').update(item.text).digest('hex')!==r.sha256)return undefined;return {kind:r.kind,excerpts:[...r.excerpts]};}
