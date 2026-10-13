import { createConnection } from 'node:net';
import { NdjsonDecoder } from '../../runtime/transports/ndjson';
const endpoint = process.env.MULTICLIENT_BRIDGE_SOCKET;
const token = process.env.MULTICLIENT_BRIDGE_TOKEN;
async function request(input: unknown, kind: string): Promise<unknown> {
  if (!endpoint || !token) return { behavior: 'deny', message: 'Approval host is unavailable.' };
  return new Promise((resolve) => {
    const socket = createConnection(endpoint);
    let settled = false;
    const complete = (value: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const parser = new NdjsonDecoder((value) => complete(value), 1024 * 1024);
    socket.on('connect', () => socket.write(JSON.stringify({ token, kind, input }) + '\n'));
    socket.on('data', (data) => {
      try {
        parser.push(data);
      } catch {
        complete({ behavior: 'deny', message: 'Malformed host response.' });
      }
    });
    socket.on('error', () =>
      complete({ behavior: 'deny', message: 'Approval host disconnected.' }),
    );
    socket.on('end', () => complete({ behavior: 'deny', message: 'Approval host disconnected.' }));
  });
}
function respond(id: unknown, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
if (process.argv[2] === 'mcp') {
  const parser = new NdjsonDecoder(async (message) => {
    if (message.id === undefined) return;
    if (message.method === 'initialize')
      respond(message.id, {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'multiclient-permissions', version: '0.1.0' },
      });
    else if (message.method === 'ping') respond(message.id, {});
    else if (message.method === 'tools/list')
      respond(message.id, {
        tools: [
          {
            name: 'permission',
            description: 'Ask the local user for a permission decision.',
            inputSchema: {
              type: 'object',
              properties: { tool_name: { type: 'string' }, input: { type: 'object' } },
              required: ['tool_name', 'input'],
            },
          },
        ],
      });
    else if (message.method === 'tools/call' && message.params?.name === 'permission')
      respond(message.id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(await request(message.params.arguments, 'permission')),
          },
        ],
      });
    else
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Unsupported method' },
        }) + '\n',
      );
  });
  process.stdin.on('data', (data) => {
    try {
      parser.push(data);
    } catch {
      process.exitCode = 1;
      process.stdin.destroy();
    }
  });
} else {
  let data = '';
  process.stdin.on('data', (chunk) => {
    data += chunk;
    if (data.length > 1024 * 1024) process.exit(2);
  });
  process.stdin.on('end', async () => {
    try {
      process.stdout.write(JSON.stringify(await request(JSON.parse(data), 'hook')));
    } catch {
      process.exitCode = 2;
    }
  });
}
