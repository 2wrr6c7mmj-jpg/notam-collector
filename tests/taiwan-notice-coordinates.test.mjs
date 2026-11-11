import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNoticeText, coordinatePairs} from '../taiwan-notice/coordinates.mjs';

const points = raw =>
  coordinatePairs(normalizeNoticeText(raw)).points.map(p => [+p.lat.toFixed(4), +p.lon.toFixed(4)]);

// Each sample is a coordinate line as it appears in a published notice.
test('reads the ways Taiwanese notices write a point', () => {
  const zhongfu = [25.1286, 121.3178];
  assert.deepEqual(points('A：25°07’43”N 121°19’04”E'), [zhongfu]);
  assert.deepEqual(points('A：北緯 25°07’43” ，東經 121°19’04” 。'), [zhongfu]);
  assert.deepEqual(points('Lat.25°07´43〞,Long.121°19´04〞E'), [zhongfu]);
  assert.deepEqual(points('A：121°19\'04"E 25°07\'43"N'), [zhongfu]);
  assert.deepEqual(points("25゜07'43＂N/121゜19'04＂E"), [zhongfu]);
  assert.deepEqual(points('N 25度07分43秒 E 121度19分04秒'), [zhongfu]);
  assert.deepEqual(points('A： Lat.25°20&apos;N. Long.121°23&apos;E.'), [[25.3333, 121.3833]]);
  assert.deepEqual(points('O：24°48＇N 121°49＇E'), [[24.8, 121.8167]]);
});

test('a point label that looks like a hemisphere is not one', () => {
  assert.deepEqual(points('E：24°44＇N 121°49＇E\nN：24°45＇N 121°52＇E'), [
    [24.7333, 121.8167],
    [24.75, 121.8667],
  ]);
});

test('joins a latitude with the longitude printed on a following line', () => {
  const text =
    'A：22°54’54”Ｎ\n農業部漁 業 署 119°25’29”Ｅ\n高雄市政府海洋局 B：22°54’54”Ｎ\n空對空域 119°45’29”Ｅ';
  assert.deepEqual(points(text), [
    [22.915, 119.4247],
    [22.915, 119.7581],
  ]);
});

test('never pairs across the label of another point', () => {
  const {points: found, leftovers} = coordinatePairs(
    normalizeNoticeText('A：25°07’43”N\nB：121°19’16”E'),
  );
  assert.equal(found.length, 0);
  assert.equal(leftovers.length, 2);
});

test('repairs the two slips found in published notices', () => {
  // Seconds of 60: the same notice prints this corner as 26°14'00" elsewhere.
  assert.deepEqual(points('C：26°13’60”N 119°59’48”E'), points('C：26°14’00”N 119°59’48”E'));
  assert.deepEqual(points('⊕：22°08’82”Ｎ121°03’23”Ｅ'), points('⊕：22°09’22”Ｎ121°03’23”Ｅ'));
  // A longitude split by the text layer.
  assert.deepEqual(
    points('Lat. 22°19\'00.0" N., Long. 12 0°53\'00.0" E.'),
    points('Lat. 22°19\'00.0" N., Long. 120°53\'00.0" E.'),
  );
  assert.deepEqual(points('Lat.24°48\'00", Long.12 1 °49\'00 "。'), [[24.8, 121.8167]]);
});

test('drops what cannot be a coordinate', () => {
  assert.deepEqual(points('25°77’43”N 121°19’04”E'), []);
  assert.deepEqual(points('95°07’43”N 121°19’04”E'), []);
  assert.deepEqual(points('最大高度 6,000呎 0800-1700 115年11月10日'), []);
});

test('a form typed without the degree sign is read next to the hemisphere letter', () => {
  const {points} = coordinatePairs(
    normalizeNoticeText('A:22∘54’54’N\n119 25’29’E\nC:22∘34’54’N\n119 45 29 E\n共 119 25 29 件'),
  );
  assert.deepEqual(
    points.map(p => [p.lat.toFixed(4), p.lon.toFixed(4)]),
    [
      ['22.9150', '119.4247'],
      ['22.5817', '119.7581'],
    ],
  );
});
