import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { researchLimits } from '../../shared/research';

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const)
  denied.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !denied.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
}
export function publicUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid public HTTPS URL.');
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password)
    throw new Error('Web sources require public HTTPS links on port 443 without credentials.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    isIP(hostname.replace(/^\[|\]$/g, '')) ||
    !hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(hostname)
  )
    throw new Error('Local and private web addresses are unavailable.');
  url.hostname = hostname;
  url.hash = '';
  return url;
}
export type NetworkResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  bytes: Buffer;
};
export type ResearchNetwork = {
  resolve(hostname: string): Promise<{ address: string; family: number }[]>;
  get(
    url: URL,
    address: { address: string; family: number },
    signal: AbortSignal,
    maxBytes: number,
    headers?: Record<string, string>,
    onBytes?: (bytes: number) => void,
  ): Promise<NetworkResponse>;
};
export const researchNetwork: ResearchNetwork = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  get(url, address, signal, maxBytes, headers = {}, onBytes) {
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          agent: false,
          family: address.family,
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
          signal,
          headers: {
            'user-agent': 'Multiclient/0.1 WebSources',
            accept: 'text/html,text/plain,application/pdf',
            'accept-encoding': 'gzip, deflate, br',
            ...headers,
          },
        },
        (response) => {
          const resultHeaders = Object.fromEntries(
            Object.entries(response.headers).map(([name, value]) => [
              name,
              Array.isArray(value) ? value.join(',') : value,
            ]),
          );
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
            response.destroy();
            resolve({
              status: response.statusCode,
              headers: resultHeaders,
              bytes: Buffer.alloc(0),
            });
            return;
          }
          const encoding = response.headers['content-encoding']?.toLowerCase();
          const decoder =
            encoding === 'gzip'
              ? createGunzip()
              : encoding === 'deflate'
                ? createInflate()
                : encoding === 'br'
                  ? createBrotliDecompress()
                  : undefined;
          if (encoding && encoding !== 'identity' && !decoder) {
            response.destroy();
            reject(new Error('Unsupported response compression.'));
            return;
          }
          const stream = decoder ? response.pipe(decoder) : response;
          const limit = response.headers['content-type']
            ?.toLowerCase()
            .startsWith('application/pdf')
            ? maxBytes
            : Math.min(maxBytes, researchLimits.htmlBytes);
          let wireBytes = 0;
          let bytes = 0;
          const chunks: Buffer[] = [];
          const fail = (error: Error) => {
            response.destroy();
            decoder?.destroy();
            req.destroy();
            reject(error);
          };
          response.on('data', (chunk: Buffer) => {
            wireBytes += chunk.length;
            if (wireBytes > limit) fail(new Error('The web source exceeded its download limit.'));
          });
          response.on('error', fail);
          stream.on('error', fail);
          stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            try {
              onBytes?.(chunk.length);
            } catch {
              fail(new Error('The research batch exceeded its download limit.'));
              return;
            }
            if (bytes > limit)
              fail(new Error('The decoded web source exceeded its download limit.'));
            else chunks.push(chunk);
          });
          stream.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: resultHeaders,
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on('error', reject);
      req.setTimeout(researchLimits.fetchMs, () =>
        req.destroy(new Error('The web source timed out.')),
      );
      req.end();
    });
  },
};
export async function fetchPublicPage(
  input: string,
  signal: AbortSignal,
  network: ResearchNetwork = researchNetwork,
  headers?: Record<string, string>,
  budget?: { remaining: number },
) {
  let url = publicUrl(input);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(researchLimits.fetchMs)]);
  for (let redirects = 0; redirects <= 3; redirects++) {
    bounded.throwIfAborted();
    const addresses = await new Promise<{ address: string; family: number }[]>(
      (resolve, reject) => {
        const abort = () => reject(new Error('Web capture cancelled or timed out.'));
        bounded.addEventListener('abort', abort, { once: true });
        network
          .resolve(url.hostname)
          .then(resolve, reject)
          .finally(() => bounded.removeEventListener('abort', abort));
      },
    );
    bounded.throwIfAborted();
    if (!addresses.length || addresses.some((address) => !publicAddress(address.address)))
      throw new Error('The web address resolved to a private or unsupported network.');
    if (budget && budget.remaining <= 0)
      throw new Error('The research batch exceeded its download limit.');
    let counted = 0;
    const consume = (bytes: number) => {
      counted += bytes;
      if (budget) {
        budget.remaining -= bytes;
        if (budget.remaining < 0)
          throw new Error('The research batch exceeded its download limit.');
      }
    };
    const response = await network.get(
      url,
      addresses[0],
      bounded,
      Math.min(researchLimits.pdfBytes, budget?.remaining ?? researchLimits.pdfBytes),
      headers,
      consume,
    );
    // Injectable fixture transports may return a buffer without streaming callbacks.
    if (!counted) consume(response.bytes.length);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.location || redirects === 3)
        throw new Error('Too many or invalid web redirects.');
      if (headers) throw new Error('Search credentials cannot follow redirects.');
      url = publicUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (response.status !== 200)
      throw new Error(`The source could not be read (HTTP ${response.status}).`);
    const mime = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (
      ![
        'text/html',
        'application/xhtml+xml',
        'text/plain',
        'application/pdf',
        'application/json',
      ].includes(mime)
    )
      throw new Error('This web source has an unsupported content type.');
    const limit = mime === 'application/pdf' ? researchLimits.pdfBytes : researchLimits.htmlBytes;
    if (response.bytes.length > limit)
      throw new Error('The web source exceeded its content limit.');
    return { url: url.href, mime, bytes: response.bytes };
  }
  throw new Error('Too many web redirects.');
}
