import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { rm } from 'node:fs/promises';
import { renderDiagram } from '../../src/main/artifacts';
import { after } from '../wait-for';

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), ipcMain: {}, dialog: {} }));
vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('C:/diagram-fixture'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
}));

let window: {
  loadFile: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  setMenu: ReturnType<typeof vi.fn>;
  webContents: {
    executeJavaScript: ReturnType<typeof vi.fn>;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    session: {
      setPermissionRequestHandler: ReturnType<typeof vi.fn>;
      setPermissionCheckHandler: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      webRequest: { onBeforeRequest: ReturnType<typeof vi.fn> };
    };
  };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  let destroyed = false;
  window = {
    loadFile: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    isDestroyed: vi.fn(() => destroyed),
    setMenu: vi.fn(),
    webContents: {
      executeJavaScript: vi.fn().mockResolvedValue('<svg>fixture</svg>'),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        on: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
      },
    },
  };
  vi.mocked(BrowserWindow).mockImplementation(function () {
    return window as unknown as BrowserWindow;
  });
});
afterEach(() => vi.useRealTimers());

it('allows bounded slow initialization without consuming the five-second Mermaid execution budget', async () => {
  window.loadFile.mockImplementation(() => after(20000));
  window.webContents.executeJavaScript.mockImplementation(() =>
    after(4000).then(() => '<svg>fixture</svg>'),
  );
  let completed = false;
  const operation = renderDiagram('graph TD\nA-->B', 'renderer.js').then((value) => {
    completed = true;
    return value;
  });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(19999);
  expect(window.webContents.executeJavaScript).not.toHaveBeenCalled();
  expect(window.destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(window.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3999);
  expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await operation).toBe('<svg>fixture</svg>');
  expect(window.destroy).toHaveBeenCalledTimes(1);
  expect(rm).toHaveBeenCalledWith('C:/diagram-fixture', { recursive: true, force: true });
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds hanging initialization and cleans the renderer without executing diagram input', async () => {
  window.loadFile.mockImplementation(() => new Promise(() => {}));
  const operation = renderDiagram('graph TD\nA-->B', 'renderer.js').catch((error) => error);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(29999);
  expect(window.destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await operation).toMatchObject({
    message: expect.stringContaining('renderer could not start'),
  });
  expect(window.webContents.executeJavaScript).not.toHaveBeenCalled();
  expect(window.destroy).toHaveBeenCalledTimes(1);
  expect(rm).toHaveBeenCalledWith('C:/diagram-fixture', { recursive: true, force: true });
  expect(vi.getTimerCount()).toBe(0);
});

it('still interrupts hanging Mermaid execution after five seconds and cleans the renderer', async () => {
  window.webContents.executeJavaScript.mockImplementation(() => new Promise(() => {}));
  const operation = renderDiagram('graph TD\nA-->B', 'renderer.js').catch((error) => error);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(4999);
  expect(window.destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await operation).toMatchObject({
    message: expect.stringContaining('Simplify the diagram'),
  });
  expect(window.destroy).toHaveBeenCalledTimes(1);
  expect(rm).toHaveBeenCalledWith('C:/diagram-fixture', { recursive: true, force: true });
  expect(vi.getTimerCount()).toBe(0);
});
