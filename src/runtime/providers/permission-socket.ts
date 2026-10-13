import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, posix } from 'node:path';

/** Usable sockaddr_un.sun_path bytes, excluding the terminating NUL. */
export function sunPathLimit(platform = process.platform) {
  // Linux UNIX_PATH_MAX is 108 including NUL. macOS and BSD sun_path is 104 including NUL.
  return platform === 'linux' ? 107 : 103;
}

/**
 * Permission bridge endpoint. Windows keeps a named pipe. Unix uses a short
 * hash under <root>/mc when that fits in sun_path, and otherwise /tmp/mc.
 * GitHub's macOS TMPDIR plus dataDir/bridges/<uuid>/permission.sock exceeds
 * the 104-byte macOS sockaddr, and a TMPDIR longer than sun_path cannot host
 * the socket either.
 */
export function permissionBridgeEndpoint(
  platform = process.platform,
  root = tmpdir(),
  fallbackRoot = '/tmp',
) {
  if (platform === 'win32') return `\\\\.\\pipe\\multiclient-${randomUUID()}`;
  const name = `${randomBytes(8).toString('hex')}.sock`;
  const limit = sunPathLimit(platform);
  const roots = fallbackRoot && fallbackRoot !== root ? [root, fallbackRoot] : [root];
  let longest = 0;
  for (const candidate of roots) {
    const socket = posix.join(candidate, 'mc', name);
    const bytes = Buffer.byteLength(socket);
    longest = Math.max(longest, bytes);
    if (bytes <= limit) return socket;
  }
  throw new Error(
    `Permission bridge socket path is ${longest} bytes and exceeds the ${limit}-byte sun_path limit.`,
  );
}

export async function preparePermissionSocketDirectory(socket: string) {
  const directory = dirname(socket);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Permission bridge socket directory must be a real directory.');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid())
    throw new Error('Permission bridge socket directory is not owned by this user.');
  if ((info.mode & 0o077) !== 0) await chmod(directory, 0o700);
  return directory;
}
