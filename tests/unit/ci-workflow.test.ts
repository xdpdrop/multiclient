import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const verifyJob = workflow.slice(workflow.indexOf('  verify:'), workflow.indexOf('  release:'));
const matrixOs = verifyJob.match(/^\s+os: (.+)$/m)?.[1] ?? '';

describe('ci.yml runner matrix', () => {
  it('has a verify job with an os matrix line', () => {
    expect(verifyJob.length).toBeGreaterThan(0);
    expect(matrixOs).not.toBe('');
  });

  it('runs ubuntu only unless the ref is a v* tag or the run is manual', () => {
    expect(matrixOs).toBe(
      `\${{ fromJSON((startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch') && '["windows-latest","ubuntu-latest","macos-latest"]' || '["ubuntu-latest"]') }}`,
    );
  });

  it('names Windows and macOS runners nowhere else in the verify job', () => {
    const outsideMatrix = verifyJob.replace(matrixOs, '');
    expect(outsideMatrix).not.toMatch(/windows-latest|macos-latest/);
  });

  it('runs Lint before Typecheck via ci-step.sh', () => {
    const lint = verifyJob.indexOf('name: Lint\n');
    const typecheck = verifyJob.indexOf('name: Typecheck\n');
    expect(lint).toBeGreaterThan(-1);
    expect(typecheck).toBeGreaterThan(lint);
    expect(verifyJob.slice(lint, typecheck)).toMatch(/run: bash scripts\/ci-step\.sh npm run lint/);
  });

  it('keeps the release job on Windows for v* tag pushes', () => {
    const release = workflow.slice(workflow.indexOf('  release:'));
    expect(release).toMatch(
      /if: success\(\) && github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/,
    );
    expect(release).toMatch(/runs-on: windows-latest/);
  });
});
