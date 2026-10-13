import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { randomUUID } from 'node:crypto';
import { startTransition, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { useComposerDraft } from '../../src/renderer/drafts';
import type { Draft } from '../../src/shared/types';

const fallback: Draft = {
  text: '',
  attachments: [],
  provider: 'compatible',
  model: 'fixture',
  mode: 'chat',
  effort: '',
};
let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(() => {
  cleanup();
  dom.window.close();
  vi.unstubAllGlobals();
});
describe('draft context initialization', () => {
  it('merges a delayed source patch into the latest typed text, attachments and selected controls', async () => {
    const desktop = {
      draft: vi.fn().mockResolvedValue({ ...fallback }),
      saveDraft: vi.fn().mockResolvedValue(undefined),
    };
    Object.assign(window, { desktop });
    let version = 0;
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const key = randomUUID();
    const source = { snapshotId: randomUUID(), included: true };
    const attachment = { path: 'captured.txt', content: 'Keep the captured attachment' };
    const { result } = renderHook(() => {
      useSyncExternalStore(
        subscribe,
        () => version,
        () => version,
      );
      return useComposerDraft(key, fallback, vi.fn());
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let releaseSource!: () => void;
    const prepared = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });
    const inclusion = prepared.then(() =>
      result.current.update((current) => ({
        contextRefs: [...(current.contextRefs ?? []), source],
      })),
    );
    await act(async () => {
      startTransition(() =>
        result.current.update({
          text: 'Keep text typed while preparing a source',
          provider: 'anthropic',
          model: 'custom-model',
          effort: 'medium',
          customModel: true,
          attachments: [attachment],
        }),
      );
      flushSync(() => {
        version++;
        [...listeners].forEach((listener) => listener());
      });
      releaseSource();
      await inclusion;
    });
    expect(result.current.draft).toMatchObject({
      text: 'Keep text typed while preparing a source',
      provider: 'anthropic',
      model: 'custom-model',
      effort: 'medium',
      customModel: true,
      attachments: [attachment],
      contextRefs: [source],
    });
    await waitFor(() =>
      expect(desktop.saveDraft).toHaveBeenLastCalledWith(key, result.current.draft),
    );
  });
  it('discards an old asynchronous hydration result after an explicit draft replacement', async () => {
    let finishRead!: (value: Draft) => void;
    const desktop = {
      draft: vi.fn(
        () =>
          new Promise<Draft>((resolve) => {
            finishRead = resolve;
          }),
      ),
      saveDraft: vi.fn().mockResolvedValue(undefined),
    };
    Object.assign(window, { desktop });
    const key = randomUUID();
    const desired: Draft = {
      ...fallback,
      text: 'Replacement draft',
      model: 'chosen-model',
      attachments: [{ path: 'preserved.txt', content: 'Keep me' }],
      contextRefs: [{ snapshotId: randomUUID(), included: true }],
    };
    const { result } = renderHook(() => useComposerDraft(key, fallback, vi.fn()));
    expect(result.current.ready).toBe(false);
    await act(async () => {
      await result.current.replace(key, desired);
    });
    act(() => result.current.update({ text: 'New typing after explicit replacement' }));
    await act(async () => {
      finishRead({ ...fallback, text: 'Stale persisted text' });
      await Promise.resolve();
    });
    expect(result.current.draft).toEqual({
      ...desired,
      text: 'New typing after explicit replacement',
    });
    expect(result.current.ready).toBe(true);
    await waitFor(() =>
      expect(desktop.saveDraft).toHaveBeenLastCalledWith(key, result.current.draft),
    );
  });
  it('keeps typed text when a synchronous snapshot refresh interrupts a pending draft update before a source patch', async () => {
    const desktop = {
      draft: vi.fn().mockResolvedValue({ ...fallback }),
      saveDraft: vi.fn().mockResolvedValue(undefined),
    };
    Object.assign(window, { desktop });
    let version = 0;
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const key = randomUUID();
    const ref = { snapshotId: randomUUID(), included: true };
    const { result } = renderHook(() => {
      useSyncExternalStore(
        subscribe,
        () => version,
        () => version,
      );
      return useComposerDraft(key, fallback, vi.fn());
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => {
      startTransition(() => result.current.update({ text: 'Use my selected preference' }));
      flushSync(() => {
        version++;
        listeners.forEach((listener) => listener());
      });
      result.current.update({ contextRefs: [ref] });
    });
    expect(result.current.draft.text).toBe('Use my selected preference');
    expect(result.current.draft.contextRefs).toEqual([ref]);
    await waitFor(() =>
      expect(desktop.saveDraft).toHaveBeenLastCalledWith(
        key,
        expect.objectContaining({ text: 'Use my selected preference', contextRefs: [ref] }),
      ),
    );
  });
  it('recovers an existing unsent draft intact after a failed persisted-draft read', async () => {
    const saved: Draft = {
      ...fallback,
      text: 'Unsent work',
      attachments: [{ path: 'captured.txt', content: 'Keep this attachment' }],
      customModel: true,
      contextRefs: [{ snapshotId: randomUUID(), included: true, reviewed: true }],
      excludedContextSnapshotIds: [randomUUID()],
    };
    const desktop = {
      draft: vi
        .fn()
        .mockRejectedValueOnce(new Error('Runtime unavailable'))
        .mockResolvedValue(saved),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
    };
    Object.assign(window, { desktop });
    const key = randomUUID();
    const { result } = renderHook(() => useComposerDraft(key, fallback, vi.fn()));
    await waitFor(() => expect(result.current.loadError).toBe('Runtime unavailable'));
    expect(result.current.ready).toBe(false);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.draft).toEqual(saved);
    expect(desktop.saveDraft).not.toHaveBeenCalled();
    expect(desktop.send).not.toHaveBeenCalled();
  });
  it('blocks sending and writes after a default-source failure, then retries the full context without inference', async () => {
    const report = vi.fn();
    const refs = [{ snapshotId: randomUUID(), included: true }];
    const desktop = {
      draft: vi.fn().mockResolvedValue(null),
      projectDefaults: vi.fn().mockResolvedValue({ text: 'Project starter' }),
      projectContextDefaults: vi
        .fn()
        .mockRejectedValueOnce(new Error('Configured sources exceed the budget'))
        .mockResolvedValue(refs),
      memoryDefaults: vi.fn().mockResolvedValue([]),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
    };
    Object.assign(window, { desktop });
    const key = randomUUID();
    const { result } = renderHook(() =>
      useComposerDraft(`new:${key}`, fallback, report, true, 'project'),
    );
    await waitFor(() => expect(result.current.loadError).toContain('exceed the budget'));
    expect(result.current.ready).toBe(false);
    act(() => result.current.update({ text: 'An initialization omission must not be saved' }));
    expect(desktop.saveDraft).not.toHaveBeenCalled();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.loadError).toBe('');
    expect(result.current.draft.text).toBe('Project starter');
    expect(result.current.draft.contextRefs).toEqual(refs);
    expect(desktop.send).not.toHaveBeenCalled();
  });
});
