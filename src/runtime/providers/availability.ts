import { homedir } from 'node:os';
import { z } from 'zod';
import { capabilities } from '../../shared/defaults';
import type { Availability, Connection } from '../../shared/types';
import { childEnvironment, exec, findExecutable, version } from './process';
import { CodexConnection } from './codex';
import { isLoopbackEndpoint, validateEndpoint } from './api';
import { effectiveCapabilities } from '../../shared/certification';

type Authentication = Pick<Availability, 'status' | 'detail' | 'usage'>;
export function parseAuthentication(id: Connection['id'], output: string): Authentication {
  if (id === 'claude-code') {
    const auth = z
      .object({ loggedIn: z.boolean(), authMethod: z.string().nullish() })
      .parse(JSON.parse(output));
    if (auth.loggedIn && auth.authMethod === 'claude.ai')
      return {
        status: 'ready',
        detail: 'Claude Code is installed and signed in with your Claude account.',
      };
    if (!auth.loggedIn || auth.authMethod)
      return { status: 'sign-in', detail: 'Sign in to Claude Code with your Claude account.' };
  }
  if (id === 'cursor') {
    const text = output.replace(/\u001b\[[0-9;]*m/g, '');
    if (/not (?:logged in|authenticated)|unauthenticated|logged out/i.test(text))
      return { status: 'sign-in', detail: 'Sign in to the official Cursor CLI.' };
    if (/\b(?:logged in as|authenticated as)\b/i.test(text))
      return {
        status: 'ready',
        detail: 'Cursor CLI is installed and reports that you are signed in.',
      };
  }
  return {
    status: 'unknown',
    detail:
      'CLI installed, but this version did not return a recognized sign-in status. Check sign-in in the official CLI.',
  };
}

async function authentication(connection: Connection, executable: string): Promise<Authentication> {
  if (connection.id === 'codex') {
    const client = new CodexConnection({
      connection,
      executable,
      cwd: homedir(),
      dataDir: homedir(),
      bridgePath: '',
      signal: new AbortController().signal,
      emit: () => {},
      interact: async () => {
        throw new Error('Interactions are unavailable during a connection check.');
      },
    });
    try {
      await client.initialize();
      if ((await client.accountType()) !== 'chatgpt')
        return { status: 'sign-in', detail: 'Sign in to Codex with your ChatGPT account.' };
      // Usage is optional: a quota endpoint failure must not mark a signed-in CLI offline.
      const usage = await client.usage().catch(() => undefined);
      return {
        status: 'ready',
        detail: 'Codex is installed and signed in with your ChatGPT account.',
        usage,
      };
    } finally {
      await client.close();
    }
  }
  const args = connection.id === 'claude-code' ? ['auth', 'status', '--json'] : ['status'];
  try {
    const result = await exec(executable, args, {
      cwd: homedir(),
      env: childEnvironment(),
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 32768,
    });
    return parseAuthentication(connection.id, result.stdout);
  } catch (error) {
    // A documented signed-out response may exit with 1. Never return raw CLI output:
    // it may include account identifiers, endpoint configuration or credentials.
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    if (failure.code === 1) {
      const status = parseAuthentication(connection.id, failure.stdout || failure.stderr || '');
      if (status.status === 'sign-in') return status;
    }
    throw new Error('Authentication status check failed.');
  }
}

export async function probe(connection: Connection): Promise<Availability> {
  const base = {
    id: connection.id,
    capabilities: effectiveCapabilities(
      connection.id,
      '',
      process.platform,
      process.env.MULTICLIENT_DEVELOPMENT_MODES === '1',
    ),
  };
  if (connection.kind === 'api-chat') {
    try {
      validateEndpoint(connection.endpoint);
    } catch {
      return {
        ...base,
        installed: true,
        status: 'error',
        detail: 'Set a valid HTTPS API base URL, or a loopback HTTP URL for a local server.',
      };
    }
    const keylessLocal = connection.id === 'compatible' && isLoopbackEndpoint(connection.endpoint);
    return {
      ...base,
      installed: true,
      status: connection.configured || keylessLocal ? 'unknown' : 'sign-in',
      detail: keylessLocal
        ? 'Local endpoint configured; no key required. Use Test connection to verify the server and model.'
        : connection.configured
          ? 'API key configured. Use Test connection to verify account and model access.'
          : 'Add your own API key. API billing is separate from subscriptions.',
    };
  }
  let executable: string;
  try {
    executable = await findExecutable(connection.id, connection.executable);
  } catch {
    return {
      ...base,
      installed: false,
      status: connection.executable ? 'error' : 'not-installed',
      detail: connection.executable
        ? 'The configured executable could not be found. Check its path.'
        : 'Install the official CLI, then refresh connections.',
    };
  }
  let installedVersion: string;
  try {
    installedVersion = await version(executable);
  } catch {
    return {
      ...base,
      installed: true,
      path: executable,
      status: 'error',
      detail: 'The CLI was found but could not start. Check its installation.',
    };
  }
  try {
    base.capabilities = effectiveCapabilities(
      connection.id,
      installedVersion,
      process.platform,
      process.env.MULTICLIENT_DEVELOPMENT_MODES === '1',
    );
    return {
      ...base,
      installed: true,
      path: executable,
      version: installedVersion,
      ...(await authentication(connection, executable)),
    };
  } catch {
    return {
      ...base,
      installed: true,
      path: executable,
      version: installedVersion,
      status: 'error',
      detail: 'Could not verify sign-in. Try refreshing or sign in using the official CLI.',
    };
  }
}
