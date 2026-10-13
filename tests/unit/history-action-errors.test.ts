// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryBrowser } from '../../src/renderer/features/HistoryBrowser';
import { useApp } from '../../src/renderer/state';

const originalState = useApp.getState();
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
  useApp.setState(originalState, true);
  vi.unstubAllGlobals();
});

it('starts archive actions disabled on the first render before effects run', () => {
  useApp.setState({ snapshot: null });
  const html = renderToStaticMarkup(
    createElement(HistoryBrowser, { initialArchive: true, onClose: vi.fn() }),
  );
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const label of ['Import conversation JSON', 'Create backup', 'Restore backup']) {
    const button = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    )!;
    expect(button.disabled).toBe(true);
  }
});

it('keeps archive actions disabled until the initial archive query completes', async () => {
  let finish!: (data: never[]) => void;
  const desktop = {
    tags: vi.fn().mockResolvedValue([]),
    archivedConversations: vi.fn(
      () =>
        new Promise<never[]>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  Object.assign(window, { desktop });
  useApp.setState({ snapshot: null, report: vi.fn() });
  const ui = render(createElement(HistoryBrowser, { initialArchive: true, onClose: vi.fn() }));
  const action = ui.getByRole('button', {
    name: 'Import conversation JSON',
  }) as HTMLButtonElement;
  expect(action.disabled).toBe(true);
  await waitFor(() => expect(desktop.archivedConversations).toHaveBeenCalledTimes(1));
  expect(action.disabled).toBe(true);
  await act(async () => {
    finish([]);
  });
  expect(action.disabled).toBe(false);
});

it('commits newly opened archive actions disabled and does not reload the current tab', async () => {
  const desktop = {
    tags: vi.fn().mockResolvedValue([]),
    archivedConversations: vi.fn().mockResolvedValue([]),
  };
  Object.assign(window, { desktop });
  useApp.setState({ snapshot: null, report: vi.fn() });
  const ui = render(createElement(HistoryBrowser, { onClose: vi.fn() }));
  await waitFor(() => expect(ui.getByRole('status').textContent).toBe(''));
  const committedDisabledStates: boolean[] = [];
  const appendChild = Node.prototype.appendChild;
  const append = vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function <
    T extends Node,
  >(this: Node, child: T): T {
    const result = appendChild.call(this, child) as T;
    if (child instanceof Element && child.isConnected) {
      for (const button of child.querySelectorAll('button')) {
        if (button.textContent === 'Import conversation JSON') {
          committedDisabledStates.push(button.disabled);
        }
      }
    }
    return result;
  });
  try {
    fireEvent.click(ui.getByRole('button', { name: 'Archive & backups' }));
  } finally {
    append.mockRestore();
  }
  expect(committedDisabledStates).toEqual([true]);
  const importButton = ui.getByRole('button', {
    name: 'Import conversation JSON',
  }) as HTMLButtonElement;
  await waitFor(() => expect(importButton.disabled).toBe(false));
  fireEvent.click(ui.getByRole('button', { name: 'Archive & backups' }));
  expect(importButton.disabled).toBe(false);
  expect(desktop.archivedConversations).toHaveBeenCalledTimes(1);
});

it.each([
  { button: 'Create backup', route: 'backup' },
  { button: 'Import conversation JSON', route: 'importConversation' },
])(
  'keeps archive actions disabled while $button is pending across tab queries',
  async ({ button, route }) => {
    let finish!: (value: null) => void;
    const operation = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finish = resolve;
        }),
    );
    const desktop = {
      tags: vi.fn().mockResolvedValue([]),
      archivedConversations: vi.fn().mockResolvedValue([]),
      [route]: operation,
    };
    Object.assign(window, { desktop });
    useApp.setState({
      snapshot: null,
      report: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    });
    const ui = render(createElement(HistoryBrowser, { initialArchive: true, onClose: vi.fn() }));
    await waitFor(() =>
      expect((ui.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(ui.getByRole('button', { name: button }));
    expect(operation).toHaveBeenCalledTimes(1);
    fireEvent.click(ui.getByRole('button', { name: 'Search' }));
    fireEvent.click(ui.getByRole('button', { name: 'Archive & backups' }));
    await waitFor(() => expect(desktop.archivedConversations).toHaveBeenCalledTimes(2));
    await act(async () => {});
    for (const label of ['Create backup', 'Restore backup', 'Import conversation JSON']) {
      expect((ui.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true);
    }
    await act(async () => finish(null));
    await waitFor(() =>
      expect((ui.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(false),
    );
  },
);

it.each([
  {
    button: 'Import conversation JSON',
    route: 'importConversation',
    message: 'The conversation file is corrupt. Choose a valid export.',
  },
  {
    button: 'Restore backup',
    route: 'restoreBackup',
    message: 'The backup is incompatible. Current history is preserved.',
  },
  {
    button: 'Create backup',
    route: 'backup',
    message: 'The backup destination is not writable. Choose another folder.',
  },
])(
  'announces $button failures inside the active dialog and clears the failure for an explicit retry',
  async ({ button, route, message }) => {
    const report = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    useApp.setState({ snapshot: null, report, refresh });
    const operation = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue(null);
    const desktop = {
      tags: vi.fn().mockResolvedValue([]),
      archivedConversations: vi.fn().mockResolvedValue([]),
      [route]: operation,
    };
    Object.assign(window, { desktop });
    const ui = render(createElement(HistoryBrowser, { initialArchive: true, onClose: vi.fn() }));
    const action = ui.getByRole('button', { name: button }) as HTMLButtonElement;
    await waitFor(() => expect(action.disabled).toBe(false));
    fireEvent.click(action);
    await waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ message })));
    await waitFor(() => expect(ui.getByRole('alert').textContent).toContain(message));
    expect(
      ui.getByRole('dialog', { name: 'Archive & backups' }).contains(ui.getByRole('alert')),
    ).toBe(true);
    expect(action.disabled).toBe(false);
    fireEvent.click(action);
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(ui.queryByRole('alert')).toBeNull();
  },
);
