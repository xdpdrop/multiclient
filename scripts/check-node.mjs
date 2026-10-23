import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_MAJOR = 24;
const BOX_NODE_BIN = '/home/box/tools/node-v24.22.0-linux-x64/bin';

export function checkNodeVersion(versionString) {
  if (typeof versionString !== 'string' || !versionString) {
    return { ok: false, message: failureMessage(versionString) };
  }
  const trimmed = versionString.trim();
  const match = /^v?(\d+)(?:\.\d+){0,2}(?:[-+].*)?$/i.exec(trimmed);
  if (!match) {
    return { ok: false, message: failureMessage(versionString) };
  }
  const major = Number(match[1]);
  if (!Number.isFinite(major) || major < MIN_MAJOR) {
    return { ok: false, message: failureMessage(versionString) };
  }
  return { ok: true, message: '' };
}

function failureMessage(versionString) {
  const label =
    typeof versionString === 'string' && versionString ? versionString : 'unknown version';
  return (
    `Multiclient requires Node 24 or newer (got ${label}). ` +
    `Put Node 24 first on PATH, e.g. export PATH=${BOX_NODE_BIN}:$PATH`
  );
}

function main() {
  const result = checkNodeVersion(process.version);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}

function shouldRunMain() {
  if (!process.argv[1]) return true;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return true;
  }
}

if (shouldRunMain()) main();
