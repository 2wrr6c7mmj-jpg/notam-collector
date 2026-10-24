import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateMsilSupplement} from '../notam-static-trial/src/msil-contract.mjs';
import {msilListingState} from './msil-listing-state.mjs';

export const MSIL_MANIFEST = 'msil-manifest.json';
export const MSIL_FILE = /^msil-[a-f0-9]{16}\.json$/;
export const MSIL_MANIFEST_MAX_BYTES = 16 * 1024;
export const MSIL_MAX_BYTES = 6 * 1024 * 1024;
const assert = (value, message) => { if (!value) throw Error(`MSIL public artifact: ${message}`); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const parse = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, structuredClone(value[key])]));
// Explicit public fields: never copy collection pages, quarantine, staging state,
// credentials, or a second source's original/geometry into this projection.
const itemFields = ['dataset', 'sourceCountry', 'issuerCountry', 'geographicRegion', 'countries',
  'issued', 'publicationEvidence', 'start', 'end', 'permanent', 'cancelled', 'purpose', 'warnings', 'staticSchedule',
  'detail', 'overview', 'sourceListing', 'sourceSchedule', 'periodEvidence', 'periodKnowledge'];
const originalFields = ['sourceName', 'text', 'sourceLinks', 'shapes', 'geometries'];
const acquisitionFields = ['startedAt', 'completedAt', 'windowMs', 'transportComplete', 'consistentSnapshot', 'fullWarningCoverage'];
const receiptFields = ['layer', 'offset', 'limit', 'count', 'startedAt', 'receivedAt', 'sha256', 'bytes', 'layerEnd'];
const geometryBase = shape => Object.fromEntries(Object.entries(shape).filter(([key]) =>
  !['sourceIndex', 'sourceReference', 'validityPeriods', 'timeMappingUncertain'].includes(key)));

function publicAcquisition(source, buildAt) {
  assert(source?.transportComplete === true && source.consistentSnapshot === false && source.fullWarningCoverage === false,
    'complete transport with explicitly unconfirmed snapshot/coverage required');
  assert(date(source.startedAt) && date(source.completedAt) && Date.parse(source.startedAt) <= Date.parse(source.completedAt) &&
    Date.parse(source.completedAt) <= Date.parse(buildAt), 'invalid source acquisition times');
  assert(Number.isSafeInteger(source.windowMs) && source.windowMs >= 0, 'invalid acquisition window');
  assert(Array.isArray(source.receipts) && source.receipts.length > 0 && source.receipts.length <= 9, 'bounded acquisition receipts required');
  for (const receipt of source.receipts) {
    assert([1, 2, 3].includes(receipt.layer) && Number.isSafeInteger(receipt.offset) && receipt.offset >= 0 &&
      receipt.limit === 1000 && Number.isSafeInteger(receipt.count) && receipt.count >= 0 && receipt.count <= receipt.limit &&
      sha(receipt.sha256) && Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0 && receipt.bytes <= 8 * 1024 * 1024 &&
      typeof receipt.layerEnd === 'boolean' && date(receipt.startedAt) && date(receipt.receivedAt) &&
      Date.parse(receipt.startedAt) >= Date.parse(source.startedAt) && Date.parse(receipt.receivedAt) >= Date.parse(receipt.startedAt) &&
      Date.parse(receipt.receivedAt) <= Date.parse(source.completedAt), 'invalid acquisition receipt');
  }
  return {...pick(source, acquisitionFields), receipts: source.receipts.map(receipt => pick(receipt, receiptFields))};
}

// Input is the exact immutable snapshot bytes, not another API response or a
// recompiled model. The SHA below binds this projection to that complete snapshot.
// SHA-256 detects byte changes; it is not a signature or source authentication.
export function createMsilPublicArtifact(snapshotBytes) {
  const snapshot = parse(snapshotBytes);
  assert(snapshot?.schemaVersion === 1 && date(snapshot.buildAt), 'invalid snapshot metadata');
  assert(Date.parse(snapshot.buildAt) <= Date.now() + 5 * 60 * 1000, 'snapshot build time is in the future');
  if (snapshot.msil === undefined) {
    assert(!snapshot.maritime?.integration?.items?.length, 'integration without MSIL acquisition');
    return null;
  }
  const source = snapshot.msil, integration = snapshot.maritime?.integration;
  validateMsilSupplement(source);
  if (!source.items.length) {
    assert(!integration?.items?.length, 'integration without a completed MSIL acquisition');
    return null; // Initial unavailable source must not block other public datasets.
  }
  assert(integration?.schemaVersion === 1 && Array.isArray(integration.items) && integration.items.length === source.items.length &&
    integration.msilCount === source.items.length, 'integration/source count mismatch');
  const acquisition = publicAcquisition(source.acquisition, snapshot.buildAt);
  assert(typeof source.refreshMessage === 'string' && typeof source.attribution === 'string' && typeof source.constraintsUrl === 'string', 'missing source disclosure');
  const originals = new Map(source.items.map(item => [item.identity, item])), identities = new Set();
  const items = integration.items.map(item => {
    const original = originals.get(item.msilIdentity);
    assert(original && !identities.has(item.msilIdentity), 'duplicate or foreign integration identity');
    identities.add(item.msilIdentity);
    assert(item.text === original.text && item.originals?.[0]?.text === original.text, 'derived original text mismatch');
    assert(item.originals[0].sourceName === '海しる / 海上保安庁', 'invalid MSIL original attribution');
    assert(isDeepStrictEqual(item.sourceListing, msilListingState(original, source.acquisition, source.refreshState)), 'derived listing differs from source receipts/refresh state');
    for (const field of ['sourceLinks', 'shapes', 'geometries']) {
      assert(JSON.stringify(item.originals[0][field]) === JSON.stringify(original[field]), `derived original ${field} mismatch`);
    }
    assert(Array.isArray(item.shapes) && item.shapes.every(shape => Number.isSafeInteger(shape.sourceIndex) && shape.sourceIndex >= 0 && shape.sourceIndex < item.originals.length), 'invalid shape provenance');
    const shapes = item.shapes.filter(shape => shape.sourceIndex === 0);
    assert(shapes.length === original.shapes.length, 'MSIL geometry count mismatch');
    assert(shapes.every(shape => shape.sourceReference === item.originals[0].sourceName), 'invalid MSIL shape attribution');
    assert(shapes.every((shape, index) => isDeepStrictEqual(geometryBase(shape), geometryBase(original.shapes[index]))), 'derived MSIL geometry mismatch');
    return {...pick(item, itemFields), id: original.identity, location: original.name,
      msilIdentity: original.identity, text: original.text, sourceName: '海しる / ' + original.identity.split(':')[0],
      sourceUrl: original.sourceLinks[0], sourceLinks: structuredClone(original.sourceLinks),
      shapes: structuredClone(shapes), originals: [pick(item.originals[0], originalFields)], mergeProof: null,
      attribution: source.attribution, constraintsUrl: source.constraintsUrl};
  });
  assert(identities.size === originals.size, 'incomplete identity coverage');
  const metadata = {buildAt: snapshot.buildAt, snapshotSha256: hash(snapshotBytes), sourceCompletedAt: source.acquisition.completedAt, count: items.length};
  const projection = {schemaVersion: 1, kind: 'msil-ui-projection', ...metadata, acquisition,
    refreshState: source.refreshState, refreshMessage: source.refreshMessage,
    attribution: source.attribution, constraintsUrl: source.constraintsUrl, items,
    originalHashes: source.items.map(item => ({identity: item.identity, textSha256: hash(item.text)}))};
  const bytes = Buffer.from(JSON.stringify(projection));
  assert(bytes.length <= MSIL_MAX_BYTES, 'projection exceeds 6 MiB limit');
  const sha256 = hash(bytes), file = `msil-${sha256.slice(0, 16)}.json`;
  const manifest = {schemaVersion: 1, kind: 'msil-ui-manifest', file, sha256, bytes: bytes.length, ...metadata};
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  assert(manifestBytes.length <= MSIL_MANIFEST_MAX_BYTES, 'manifest exceeds 16 KiB limit');
  return {manifest, manifestBytes, projection, bytes};
}

