// Resolve the Sites code base as-is under plain Node:
//  - "@/lib/x" path alias      -> site/lib/x
//  - extensionless relative     -> .ts / .mjs / .js / index.*
//  - JSON imports               -> JSON import attributes added automatically
import {existsSync, statSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const SITE = fileURLToPath(new URL('../site/', import.meta.url));
const EXTENSIONS = ['.ts', '.mjs', '.js', '.json'];
const isFile = file => existsSync(file) && statSync(file).isFile();

function candidate(base) {
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) if (isFile(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) if (isFile(path.join(base, 'index' + ext))) return path.join(base, 'index' + ext);
  return null;
}

// Local development only: COLLECTOR_DEV_SHIMS points bare package names at
// stand-ins when the npm registry is unreachable. CI installs real packages.
const DEV_SHIMS = process.env.COLLECTOR_DEV_SHIMS;

export async function resolve(specifier, context, next) {
  let target = null;
  if (DEV_SHIMS && /^(polygon-clipping|fflate(\/browser)?|unpdf)$/.test(specifier)) {
    return next(pathToFileURL(path.join(DEV_SHIMS, specifier.split('/')[0] + '.mjs')).href, context);
  }
  if (specifier.startsWith('@/')) target = candidate(path.join(SITE, specifier.slice(2)));
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    target = candidate(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
  }
  if (target) {
    const attributes = target.endsWith('.json') ? {...context.importAttributes, type: 'json'} : context.importAttributes;
    return next(pathToFileURL(target).href, {...context, importAttributes: attributes});
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json')) return next(url, {...context, importAttributes: {...context.importAttributes, type: 'json'}});
  return next(url, context);
}
