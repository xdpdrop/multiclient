// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { render, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { KnowledgeLibrary } from '../../src/renderer/features/KnowledgeLibrary';
import type { ContextItem, SaveContextItem } from '../../src/shared/context';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('blocks editing and saving until the selected source loads, then replaces its text exactly', async () => {
  const item: ContextItem = {
    id: '12345678-1234-4234-8234-123456789012',
    projectId: '22345678-1234-4234-8234-123456789012',
    kind: 'instructions',
    title: 'Editorial rules',
    text: 'OLD_INSTRUCTIONS',
    revision: 1,
    includeInNewChats: true,
    updatedAt: '2026-10-13T00:00:00Z',
  };
  let finishRead!: (item: ContextItem) => void;
  const desktop = {
    contextItems: vi.fn().mockResolvedValue([{ ...item, characters: item.text.length }]),
    contextItem: vi.fn(
      () =>
        new Promise<ContextItem>((resolve) => {
          finishRead = resolve;
        }),
    ),
    saveContextItem: vi.fn((input: SaveContextItem) =>
      Promise.resolve({ ...item, ...input, revision: 2 }),
    ),
  };
  Object.assign(window, { desktop });
  const ui = render(
    createElement(KnowledgeLibrary, {
      projectId: item.projectId!,
      onClose: vi.fn(),
      onInclude: vi.fn(),
    }),
  );
  await waitFor(() =>
    expect(ui.getByRole('button', { name: 'Edit Editorial rules' })).toBeTruthy(),
  );
  fireEvent.click(ui.getByRole('button', { name: 'Edit Editorial rules' }));
  const input = ui.getByLabelText('Source text') as HTMLTextAreaElement;
  expect(input.disabled).toBe(true);
  expect((ui.getByLabelText('Source title') as HTMLInputElement).disabled).toBe(true);
  expect((ui.getByRole('button', { name: 'Save source' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(desktop.saveContextItem).not.toHaveBeenCalled();
  await act(async () => {
    finishRead(item);
  });
  expect(input.disabled).toBe(false);
  expect(input.value).toBe('OLD_INSTRUCTIONS');
  fireEvent.change(input, { target: { value: 'NEW_INSTRUCTIONS' } });
  expect(input.value).toBe('NEW_INSTRUCTIONS');
  fireEvent.click(ui.getByRole('button', { name: 'Save source' }));
  await waitFor(() =>
    expect(desktop.saveContextItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: item.id, expectedRevision: 1, text: 'NEW_INSTRUCTIONS' }),
    ),
  );
});
