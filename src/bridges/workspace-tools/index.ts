import { NdjsonDecoder } from '../../runtime/transports/ndjson';
import { canonicalDirectory } from '../../runtime/files';
import { callWorkspaceTool, workspaceToolDefinitions } from '../../runtime/files/workspace-tools';

const root = process.argv[2]
  ? canonicalDirectory(process.argv[2]).catch(() => null)
  : Promise.resolve(null);
function respond(id: unknown, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
const parser = new NdjsonDecoder((message) => {
  if (message.id === undefined) return;
  void (async () => {
    if (message.method === 'initialize') {
      if (!(await root)) throw new Error('Workspace is unavailable.');
      respond(message.id, {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'multiclient-workspace', version: '0.1.0' },
      });
    } else if (message.method === 'ping') respond(message.id, {});
    else if (message.method === 'tools/list')
      respond(message.id, { tools: workspaceToolDefinitions });
    else if (message.method === 'tools/call') {
      try {
        const directory = await root;
        if (!directory) throw new Error('Workspace is unavailable.');
        const result = await callWorkspaceTool(
          directory,
          message.params?.name,
          message.params?.arguments,
        );
        respond(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (error) {
        respond(message.id, {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Unable to inspect this file.',
            },
          ],
        });
      }
    } else {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Unsupported workspace request.' },
        }) + '\n',
      );
    }
  })().catch(() => {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: 'Workspace service is unavailable.' },
      }) + '\n',
    );
  });
}, 1024 * 1024);
process.stdin.on('data', (chunk) => {
  try {
    parser.push(chunk);
  } catch {
    process.exitCode = 1;
    process.stdin.destroy();
  }
});
