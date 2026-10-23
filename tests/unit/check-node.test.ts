import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { checkNodeVersion } = createRequire(import.meta.url)('../../scripts/check-node.mjs') as {
  checkNodeVersion: (versionString: string) => { ok: boolean; message: string };
};

const NODE_24_PATH = '/home/box/tools/node-v24.22.0-linux-x64/bin';

describe('checkNodeVersion', () => {
  it('rejects Node 20 and 23 with the Node 24 message', () => {
    for (const version of ['20.19.2', 'v20.19.2', '23.9.0']) {
      const result = checkNodeVersion(version);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Node 24');
      expect(result.message).toContain(NODE_24_PATH);
    }
  });

  it('accepts Node 24 and newer', () => {
    for (const version of ['24.0.0', 'v24.0.0', '25.1.0']) {
      const result = checkNodeVersion(version);
      expect(result.ok).toBe(true);
      expect(result.message).toBe('');
    }
  });

  it('rejects malformed input', () => {
    for (const version of ['', 'not-a-version', 'v']) {
      const result = checkNodeVersion(version);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Node 24');
    }
  });
});
