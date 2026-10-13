export function isCodeMode(mode?: string) {
  return mode === 'code' || mode === 'code-bypass';
}

export function isBypassMode(mode?: string) {
  return mode === 'code-bypass';
}

export function assertSessionMode(sessionMode: string | undefined, turnMode: string) {
  if ((isCodeMode(sessionMode) || isCodeMode(turnMode)) && sessionMode !== turnMode)
    throw new Error('Start a new session when changing Code permission modes.');
}
