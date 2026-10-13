// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNarrowViewport } from '../../src/renderer/narrow-layout';

function Probe() {
  return createElement('div', null, useNarrowViewport() ? 'narrow' : 'wide');
}

function installMedia(matches: () => boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches();
    },
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('narrow viewport', () => {
  it('updates when zoom resizes the document without a media change event', () => {
    let matches = false;
    installMedia(() => matches);
    let observed: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observed = callback;
        }
        observe() {}
        disconnect() {
          observed = undefined;
        }
      },
    );
    render(createElement(Probe));
    expect(screen.getByText('wide')).toBeTruthy();
    matches = true;
    act(() => observed?.());
    expect(screen.getByText('narrow')).toBeTruthy();
  });

  it('updates when the window resizes without a media change event', () => {
    let matches = false;
    installMedia(() => matches);
    vi.stubGlobal('ResizeObserver', undefined);
    render(createElement(Probe));
    expect(screen.getByText('wide')).toBeTruthy();
    matches = true;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(screen.getByText('narrow')).toBeTruthy();
  });
});
