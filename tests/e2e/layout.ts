// The empty state centers the welcome heading and composer together.
// The form alone sits about 110px below the main midpoint on the default window.
export const EMPTY_COMPOSER_CENTER_TOLERANCE = 160;

export function composerCenterDelta(
  composer: { y: number; height: number },
  main: { y: number; height: number },
) {
  return Math.abs(composer.y + composer.height / 2 - (main.y + main.height / 2));
}
