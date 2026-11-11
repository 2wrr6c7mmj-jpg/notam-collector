import test from 'node:test';
import assert from 'node:assert/strict';
import {pageAreas, minimumRadiusNm} from '../taiwan-notice/areas.mjs';

const corners = polygon => polygon.points.map(p => [+p.lat.toFixed(4), +p.lon.toFixed(4)]);
const labels = polygon => polygon.points.map(p => p.label).join('');

// The samples keep the layout of published notices; names and telephone
// numbers on the forms are left out.
const FORM = `
9 交通部航港局東部航 A:26°10'20"N 119°53'15"E
 務中心 危險區域 B:26°10'20"N 119°54'45"E
10 行政院農業委員會漁 經緯度C:26°09'00"N 119°54'45"E
 業署 (WGS84) D:26°09'00"N 119°53'15"E
14 海洋委員會海巡署北 危險區域 ⊕:26°09'17"N 119°53'48"E
 部分署 中心點位置
16 國防部參謀本部情報 最小半徑 3浬(NM)
20 國防部空軍司令部 海 A:26°10'20"N 119°53'15"E
 域管制範圍危險區域 B:26°10'20"N 119°54'45"E
21 國防部憲兵指揮部 經緯度 C:26°09'00"N 119°54'45"E
 (WGS84 ) D:26°09'00"N 119°53'15"E
`;

test('a notification form that states its area twice yields it once', () => {
  const {polygons, centres, circles} = pageAreas(FORM);
  assert.equal(polygons.length, 1);
  assert.equal(labels(polygons[0]), 'ABCD');
  assert.deepEqual(
    centres.map(c => +c.lat.toFixed(4)),
    [26.1547],
  );
  assert.deepEqual(circles, []);
  assert.equal(minimumRadiusNm(FORM), 3);
});

test('the harbour office (航務中心) next to a corner does not make it a centre', () => {
  const [polygon] = pageAreas(FORM).polygons;
  assert.deepEqual(corners(polygon)[1], [26.1722, 119.9125]);
});

test('an unlabelled point after labelled corners is not a corner', () => {
  const {polygons, loosePoints} = pageAreas(`
 A:22°50'57"N 120°11'51"E
 經緯度 B:22°42'27"N 120°04'38"E
 (WGS84) C:22°52'19"N 119°59'48"E
 D:23°00'49"N 120°07'02"E
 危險區域 22°51'38" N 120°05'50" E
 艦隊分署 中心點位置`);
  assert.equal(labels(polygons[0]), 'ABCD');
  assert.equal(loosePoints.length, 0);
});

test('corners listed north-west, north-east, south-west, south-east are put in outline order', () => {
  const {polygons} = pageAreas(`NOTICE TO MARINERS
Positions:23°26'N ,119°10'E
 23°26'N ,119°16'E
 23°22'N ,119°10'E
 23°22'N ,119°16'E
 WGS84`);
  assert.equal(polygons[0].reordered, true);
  assert.deepEqual(corners(polygons[0]), [
    [23.3667, 119.1667],
    [23.4333, 119.1667],
    [23.4333, 119.2667],
    [23.3667, 119.2667],
  ]);
});

const MARINERS = `航船布告
 位 置:北緯 24°23'14" ,東經 118°09'40"。
 北緯 24°23'13" ,東經 118°09'41"。
 北緯 24°23'14" ,東經 118°09' 50"。
 北緯 24°22'41" ,東經 118°10'18"。
 北緯 24°22'40" ,東經 118°09'44"。*WGS84
 NOTICE TO MARINERS
Positions:Lat. 24°23'14"N.,Long.118°09'40"E.
 Lat. 24°23'13"N.,Long.118°09'41"E.
 Lat. 24°23'14"N.,Long.118°09'50"E.
 Lat. 24°22'41"N.,Long.118°10'18"E.
 Lat. 24°22'40"N.,Long.120°09'44"E. *WGS84`;

test('the Chinese text of a notice to mariners wins over the English one', () => {
  const {polygons} = pageAreas(MARINERS);
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].language, 'zh');
  assert.deepEqual(corners(polygons[0]).at(-1), [24.3778, 118.1622]);
});

test('the English text is used when the Chinese one lost a corner', () => {
  const {polygons} = pageAreas(`位 置:北緯 24°18'37",東經 120°31'08"。
 北緯 24°25'02",東經 120°36'02"。
 北緯 24°27'18",東經 120°30'47"。
 北緯 24°21'07",東經
NOTICE TO MARINERS
Positions: Lat. 24°18'37"N,Long. 120°31'08"E
 Lat. 24°25'02"N,Long. 120°36'02"E
 Lat. 24°27'18"N,Long. 120°30'47"E
 Lat. 24°21'07"N,Long. 120°25'51"E`);
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].points.length, 4);
});

test('numbers split by the text layer are joined', () => {
  const {polygons} = pageAreas(`A-N 25°10'07"E 121°24'54"
 B-N 2 5°09'01"E 121°23'33"
 C-N 25°08'37"E 121°2 3'50"
 D-N 25°09'33"E 121°25'30"`);
  assert.deepEqual(corners(polygons[0]).slice(1, 3), [
    [25.1503, 121.3925],
    [25.1436, 121.3972],
  ]);
});

test('bare points of the sketch map are dropped next to labelled corners', () => {
  const {polygons} = pageAreas(`
 N 21度49分50秒 E120度42分50秒 N 21度49分50秒
 D E120度45分50秒
 N 21度46分50秒 E120度45分50秒
 N 21度46分50秒 E120度42分50秒
 對空域 A:N 21°49'50" E 120°45'50"
 對海域 B:N 21°46'50" E 120°45'50"
 危險區域 C:N 21°46'50" E 120°42'50"
 (經緯度) D:N 21°49'50" E 120°42'50"
 管 中心點位置 N 21°48' 50" E 120°44' 50"`);
  assert.equal(polygons.length, 1);
  assert.equal(labels(polygons[0]), 'ABCD');
});

test('two areas on one form stay two areas', () => {
  const {polygons} = pageAreas(`甲區:
 E:22°41'24"N 120°15'00"E
 F:22°41'24"N 120°11'30"E
 G:22°39'48"N 120°11'30"E
 H:22°39'48"N 120°15'00"E
 乙區:
 A:22°47'57"N 120°12'08"E
 B:22°47'27"N 120°10'03"E
 C:22°42'43"N 120°11'52"E
 D:22°43'16"N 120°13'56"E`);
  assert.deepEqual(polygons.map(labels).sort(), ['ABCD', 'EFGH']);
});

test('a circle is a centre with a radius in nautical miles', () => {
  const {circles, polygons} = pageAreas(
    '以北緯 22°10\'00"、東經 120°50\'00"為中心,5浬為半徑之海域。',
  );
  assert.deepEqual(polygons, []);
  assert.equal(circles[0].radiusNm, 5);
  assert.equal(+circles[0].centre.lon.toFixed(4), 120.8333);
});

test('coordinates with the digits run together, labelled with brackets', () => {
  const {polygons} = pageAreas(`警戒區:
 A(223200N 1205736E)
 B(223200N 1211027E)
 C(220549N 1211027E)
 D(220549N 1205300E)
 以上各點連線區域
 O(231000N 1212100E)
 P(231000N 1212700E)
 Q(223200N 1212700E)
 R(223200N 1210700E)
 以上各點連線區域`);
  assert.deepEqual(polygons.map(labels), ['ABCD', 'OPQR']);
  assert.deepEqual(corners(polygons[0])[0], [22.5333, 120.96]);
});

test('"以…為中心,連接下列四點" names a centre, not a corner', () => {
  const {polygons, centres} = pageAreas(` 交通部航港局 以 252000N1203700E
 東部航務中心 為中心,連接下列四
 農業部漁業署 點為範圍:
 高雄市政府海洋局 對空域 254800N 1204800E
 對海域 254800N 1212000E
 海洋委員會海巡署 危險區域 245200N 1202300E
 艦隊分署 (經緯度) 245200N 1195500E
 北部分署 254800N 1204800E`);
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].points.length, 4);
  assert.equal(centres.length, 1);
});

test('a sector is drawn from its centre, radius and the two ends of its arc', () => {
  const {polygons, circles} = pageAreas(` 農業部漁業署 以 221910N 1203748E為中
 高雄市政府海洋局 心,10NM為半徑,自 222159N
 海洋委員會海巡署 空 對空域 1202727E反 時 針 方 向 至
 海洋委員會海巡署 海 對海域危險區域 220935N 1204100E所形成之
 艦隊分署 (經緯度)
 海洋委員會海巡署 域管制範圍 扇形空域。`);
  assert.deepEqual(circles, []);
  const [sector] = polygons;
  assert.equal(sector.sector.radiusNm, 10);
  assert.equal(sector.sector.anticlockwise, true);
  assert.deepEqual(corners(sector).slice(0, 2), [
    [22.3194, 120.63],
    [22.3664, 120.4575],
  ]);
  assert.deepEqual(corners(sector).at(-1), [22.1597, 120.6833]);
  // Anticlockwise from west-north-west to south-south-east: the arc passes
  // south-west of the centre, ten nautical miles out.
  const southWest = sector.points.find(p => p.lat < 22.2 && p.lon < 120.53);
  const nm = Math.hypot(
    (southWest.lat - 22.3194) * 60,
    (southWest.lon - 120.63) * 60 * Math.cos((22.3194 * Math.PI) / 180),
  );
  assert.ok(Math.abs(nm - 10) < 0.05, `arc point at ${nm} NM`);
});

test('a danger area given as distances from the launch pad', () => {
  const {polygons} = pageAreas(`Launch Pad: (22°10’30.26”N, 120°55’27.65”E)
Range limits:
• 6000 meters to the north
• 6000 meters to the south
• 4000 meters to the west
• 8000 meters to the east`);
  assert.equal(polygons.length, 1);
  const [box] = polygons;
  assert.deepEqual(box.rangeLimits, {
    pad: {lat: 22 + 10 / 60 + 30.26 / 3600, lon: 120 + 55 / 60 + 27.65 / 3600, precision: 'second'},
    north: 6000,
    south: 6000,
    west: 4000,
    east: 8000,
  });
  const lats = box.points.map(p => p.lat),
    lons = box.points.map(p => p.lon);
  // 6000 m is 3.24 minutes of latitude; 12 km east to west at 22°N is 6.99'.
  assert.ok(Math.abs((Math.max(...lats) - Math.min(...lats)) * 60 - 12000 / 1852) < 1e-9);
  assert.ok(Math.abs((Math.max(...lons) - Math.min(...lons)) * 60 - 6.9976) < 1e-3);
  assert.equal(
    pageAreas('發射地點 (22°10’30”N, 120°55’27”E) 往北 6000m 往南 6000m').polygons.length,
    0,
  );
});

test('the minimum radius in metres, also with the number inside the heading', () => {
  assert.ok(Math.abs(minimumRadiusNm('涵蓋危險區域最小半徑  6000m') - 6000 / 1852) < 1e-12);
  assert.ok(
    Math.abs(
      minimumRadiusNm('國防部參謀本部  涵蓋危險區域最小  865m\n  作戰及計畫參謀次長室  半徑') -
        865 / 1852,
    ) < 1e-12,
  );
  assert.equal(minimumRadiusNm('最小半徑：15浬'), 15);
});
