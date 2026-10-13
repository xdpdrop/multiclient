import { describe, it, expect } from 'vitest';
import { planContextInclusion } from '../../src/renderer/features/context-inclusion';
import type { ContextSnapshot } from '../../src/shared/context';

const snapshot = (
  id: string,
  revision: number,
  kind: ContextSnapshot['kind'] = 'instructions',
): ContextSnapshot => ({
  id,
  itemId: kind === 'instructions' ? 'instruction-item' : id,
  revision,
  kind,
  title: id,
  text: `Revision ${revision}`,
  projectId: 'project',
  createdAt: '2026-10-12T00:00:00Z',
});
describe('instruction inclusion decisions', () => {
  it('explicit sharing re-enables only selected sources that were previously excluded', () => {
    const result = planContextInclusion(
      [{ snapshotId: 'saved-memory', included: false }],
      [],
      [
        { snapshotId: 'saved-memory', included: true },
        { snapshotId: 'disabled', included: false },
      ],
      [snapshot('saved-memory', 1, 'memory'), snapshot('disabled', 1, 'note')],
      ['saved-memory', 'disabled', 'other'],
    );
    expect(result.excludedContextSnapshotIds).toEqual(['disabled', 'other']);
    expect(result.refs.find((ref) => ref.snapshotId === 'saved-memory')?.included).toBe(true);
  });
  it('replaces an older instruction pin without accumulating revisions and preserves document selection', () => {
    const current = [
      { snapshotId: 'old', included: true },
      { snapshotId: 'document', included: false },
    ];
    const incoming = [
      { snapshotId: 'new', included: true },
      { snapshotId: 'note', included: true },
    ];
    const result = planContextInclusion(
      current,
      [snapshot('old', 1), snapshot('document', 1, 'document')],
      incoming,
      [snapshot('new', 2), snapshot('note', 1, 'note')],
    );
    expect(result.instructionChanged).toBe(true);
    expect(result.refs).toEqual([{ snapshotId: 'document', included: false }, ...incoming]);
    expect(current).toEqual([
      { snapshotId: 'old', included: true },
      { snapshotId: 'document', included: false },
    ]);
  });
  it('keeps the current pin when adding ordinary sources and does not request a fork for its identical snapshot', () => {
    const current = [{ snapshotId: 'old', included: true, reviewed: true }];
    expect(
      planContextInclusion(
        current,
        [snapshot('old', 1)],
        [{ snapshotId: 'document', included: true }],
        [snapshot('document', 1, 'document')],
      ).instructionChanged,
    ).toBe(false);
    const same = planContextInclusion(current, [snapshot('old', 1)], current, [snapshot('old', 1)]);
    expect(same.instructionChanged).toBe(false);
    expect(same.refs).toEqual(current);
  });
  it('recognizes reverting to an earlier historical revision as a change from the current pin', () => {
    const result = planContextInclusion(
      [{ snapshotId: 'current', included: true }],
      [snapshot('historical', 1), snapshot('current', 2)],
      [{ snapshotId: 'historical', included: true }],
      [snapshot('historical', 1)],
    );
    expect(result.instructionChanged).toBe(true);
    expect(result.previousInstructions.map((source) => source.id)).toEqual(['current']);
    expect(result.refs).toEqual([{ snapshotId: 'historical', included: true }]);
  });
  it('rejects two incoming instruction revisions rather than inventing precedence', () => {
    expect(() =>
      planContextInclusion(
        [],
        [],
        [
          { snapshotId: 'one', included: true },
          { snapshotId: 'two', included: true },
        ],
        [snapshot('one', 1), snapshot('two', 2)],
      ),
    ).toThrow('Choose one captured revision');
  });
});
