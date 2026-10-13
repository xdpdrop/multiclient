#!/usr/bin/env bash
# Run a CI check step. On Linux, Electron needs a window manager: Xvfb alone
# does not implement EWMH, so BrowserWindow.maximize() never reports isMaximized().
set -eu
if [ "${RUNNER_OS:-}" = "Linux" ]; then
  xvfb-run --auto-servernum --server-args="-screen 0 1600x1200x24" bash -c 'set -eu
    openbox >/tmp/openbox.log 2>&1 &
    for _ in $(seq 1 50); do
      if pgrep -x openbox >/dev/null; then break; fi
      sleep 0.1
    done
    pgrep -x openbox >/dev/null
    exec "$@"
  ' bash "$@"
else
  exec "$@"
fi
