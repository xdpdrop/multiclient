/** Wall-clock pause when the caller has nothing pollable, such as a compositor frame. */
export const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Hang guard for a test that must observe a real exit. Clear with clearTimeout. */
export function guardTimeout(ms: number, onTimeout: () => void) {
  return setTimeout(onTimeout, ms);
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
