import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, choose, recordErrors, sendLocal } from './fixtures';

type ApiBody = { model: string; messages: { role: string; content: unknown }[] };
async function localApi() {
  const requests: ApiBody[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      if (request.url === '/v1/models') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            data: [{ id: 'fixture-one' }, { id: 'fixture-two' }, { id: 'fixture-fail' }],
          }),
        );
        return;
      }
      const payload = JSON.parse(body) as ApiBody;
      requests.push(payload);
      if (payload.model === 'fixture-fail') {
        response.writeHead(429);
        response.end('Fixture quota exhausted');
        return;
      }
      response.setHeader('content-type', 'text/event-stream');
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: `Answer from ${payload.model}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local API fixture unavailable');
  return {
    requests,
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function enableCompatible(page: Page, endpoint: string) {
  await page.evaluate(async (endpoint) => {
    const connection = (await window.desktop.snapshot()).connections.find(
      (c) => c.id === 'compatible',
    )!;
    await window.desktop.saveConnection({
      ...connection,
      endpoint,
      model: 'fixture-one',
      enabled: true,
    });
  }, endpoint);
  await choose(page, 'Provider', 'Compatible API');
}
async function tools(page: Page, action: string) {
  await page.getByRole('button', { name: 'Add context and tools', exact: true }).click();
  await page.getByRole('button', { name: action, exact: true }).click();
}
function text(body: ApiBody) {
  return body.messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
}

test('folderless project knowledge reaches actual API requests once and context selection preserves pinned instructions', async ({
  desktop,
}) => {
  const api = await localApi();
  const page = desktop.page;
  const errors = recordErrors(page);
  try {
    await page.getByRole('button', { name: 'Add project', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Add project', exact: true });
    await create.getByLabel('Project name', { exact: true }).fill('Daily writing');
    await create.getByRole('button', { name: 'Create chat project', exact: true }).click();
    await expect(create).toHaveCount(0);
    const project = await page.evaluate(async () =>
      (await window.desktop.snapshot()).projects.find((p) => p.name === 'Daily writing')!,
    );
    expect(project).toMatchObject({ kind: 'chat', path: null, workspaceId: null, trusted: false });
    expect(
      await page.evaluate(
        async (id) =>
          ((await window.desktop.snapshot()).workspaces ?? []).filter((w) => w.projectId === id),
        project.id,
      ),
    ).toEqual([]);

    await tools(page, 'Project knowledge');
    const knowledge = page.getByRole('dialog', { name: 'Project knowledge', exact: true });
    await knowledge.getByRole('button', { name: 'Project instructions', exact: true }).click();
    await knowledge.getByLabel('Source title', { exact: true }).fill('Editorial rules');
    await knowledge
      .getByLabel('Source text', { exact: true })
      .fill('INSTRUCTION_MARKER: answer in short sentences.');
    await knowledge.getByRole('button', { name: 'Save source', exact: true }).click();
    await expect(
      knowledge.getByRole('button', { name: 'Edit Editorial rules', exact: true }),
    ).toBeVisible();
    await knowledge.getByRole('button', { name: 'New note', exact: true }).click();
    await knowledge.getByLabel('Source title', { exact: true }).fill('Lighthouse requirements');
    await knowledge
      .getByLabel('Source text', { exact: true })
      .fill('DOCUMENT_MARKER: retain the original lighthouse door.');
    await knowledge.getByRole('button', { name: 'Save source', exact: true }).click();
    await knowledge.getByRole('checkbox', { name: 'Share Editorial rules', exact: true }).check();
    await knowledge
      .getByRole('checkbox', { name: 'Share Lighthouse requirements', exact: true })
      .check();
    await knowledge
      .getByRole('button', { name: 'Add selected sources to conversation', exact: true })
      .click();
    await expect(knowledge).toHaveCount(0);
    await enableCompatible(page, api.endpoint);
    await page.getByLabel('Message', { exact: true }).fill('First report request');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => api.requests.length).toBe(1);
    await expect(page.locator('article[data-message-role="assistant"]').last()).toContainText(
      'Answer from fixture-one',
    );
    expect(text(api.requests[0]).match(/INSTRUCTION_MARKER/g)).toHaveLength(1);
    expect(text(api.requests[0]).match(/DOCUMENT_MARKER/g)).toHaveLength(1);
    expect(api.requests[0].messages[0].role).toBe('system');

    await page.getByRole('button', { name: 'Context', exact: true }).click();
    const context = page.getByRole('dialog', { name: 'Choose conversation context', exact: true });
    await context.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await context.getByRole('button', { name: 'Use selected context', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('Second report without history');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => api.requests.length).toBe(2);
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
    expect(text(api.requests[1]).match(/INSTRUCTION_MARKER/g)).toHaveLength(1);
    expect(text(api.requests[1])).not.toContain('DOCUMENT_MARKER');
    expect(text(api.requests[1])).not.toContain('First report request');
    expect(api.requests[1].messages.map((m) => m.role)).toEqual(['system', 'user']);
    const chat = await page.evaluate(
      async () => (await window.desktop.snapshot()).conversations[0],
    );
    const historical = await page.evaluate((id) => window.desktop.transcript(id), chat.id);
    expect(historical[0].contextSources!.map((s) => s.title)).toEqual(
      expect.arrayContaining(['Editorial rules', 'Lighthouse requirements']),
    );
    await desktop.restart();
    expect(await desktop.page.evaluate((id) => window.desktop.transcript(id), chat.id)).toEqual(
      historical,
    );
    expect(errors).toEqual([]);
  } finally {
    await api.close();
  }
});

test('manual memory sharing and fresh-chat exclusion are reflected in actual API payloads', async ({
  desktop,
}) => {
  const api = await localApi();
  const page = desktop.page;
  try {
    await enableCompatible(page, api.endpoint);
    await tools(page, 'Memory');
    const memory = page.getByRole('dialog', { name: 'Saved memory', exact: true });
    await memory.getByRole('button', { name: 'Add note', exact: true }).click();
    await memory.getByLabel('Memory title', { exact: true }).fill('Preferred examples');
    await memory
      .getByLabel('Memory note', { exact: true })
      .fill('MEMORY_MARKER: prefer lighthouse engineering examples.');
    await expect(
      memory.getByRole('checkbox', {
        name: 'Include in new chats in every project and personal chat',
        exact: true,
      }),
    ).not.toBeChecked();
    await memory.getByRole('button', { name: 'Save note', exact: true }).click();
    await memory.getByRole('button', { name: 'Add to draft', exact: true }).click();
    await expect(memory).toHaveCount(0);
    await page.getByLabel('Message', { exact: true }).fill('Use my selected preference');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => api.requests.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
    expect(text(api.requests[0]).match(/MEMORY_MARKER/g)).toHaveLength(1);
    const original = await page.evaluate(
      async () => (await window.desktop.snapshot()).conversations[0],
    );
    await tools(page, 'Memory');
    await memory.getByRole('button', { name: 'Delete', exact: true }).click();
    await memory.getByRole('button', { name: 'Delete saved note', exact: true }).click();
    await expect(memory.getByText('No notes saved here yet.', { exact: true })).toBeVisible();
    await memory.getByRole('button', { name: 'Start fresh without memory', exact: true }).click();
    await expect(memory).toHaveCount(0);
    await page
      .getByLabel('Message', { exact: true })
      .fill('Fresh request without saved preference');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => api.requests.length).toBe(2);
    expect(text(api.requests[1])).not.toContain('MEMORY_MARKER');
    expect(
      (
        await page.evaluate((id) => window.desktop.transcript(id), original.id)
      )[0].contextSources!.find((s) => s.kind === 'memory')?.text,
    ).toContain('MEMORY_MARKER');
  } finally {
    await api.close();
  }
});

test('artifacts save immutable revisions and recover a working draft through restart', async ({
  desktop,
}) => {
  let page = desktop.page;
  await sendLocal(page, 'An editable report');
  await page
    .locator('article[data-message-role="assistant"]')
    .last()
    .getByRole('button', { name: 'Save answer as document', exact: true })
    .click();
  const save = page.getByRole('dialog', { name: 'Save artifact', exact: true });
  await save.getByLabel('Artifact title', { exact: true }).fill('Daily report');
  await save.getByLabel('Artifact format', { exact: true }).selectOption('markdown');
  await save.getByRole('button', { name: 'Save artifact', exact: true }).click();
  const artifacts = page.getByRole('dialog', { name: 'Artifacts', exact: true });
  await expect(artifacts).toBeVisible();
  await artifacts
    .getByLabel('Artifact source', { exact: true })
    .fill('# Saved report\n\nAccepted content.');
  await artifacts.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(artifacts.getByRole('status')).toContainText('New revision saved.');
  const captured = await page.evaluate(async () => {
    const artifact = (await window.desktop.artifactsList())[0];
    return window.desktop.artifactRead(artifact.id);
  });
  expect(captured.revisions).toHaveLength(2);
  expect(captured.revisions[1].source).not.toBe(captured.revisions[0].source);
  await artifacts
    .getByLabel('Artifact source', { exact: true })
    .fill('# Unfinished report\n\nRestore this draft.');
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await window.desktop.artifactRead(id)).draft?.source,
        captured.artifact.id,
      ),
    )
    .toBe('# Unfinished report\n\nRestore this draft.');
  await artifacts.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await desktop.restart();
  page = desktop.page;
  await page.getByRole('button', { name: 'Artifacts', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Artifacts', exact: true });
  await reopened.getByLabel('Choose artifact', { exact: true }).selectOption(captured.artifact.id);
  await expect(reopened.getByLabel('Artifact source', { exact: true })).toHaveValue(
    '# Unfinished report\n\nRestore this draft.',
  );
  expect(
    (await page.evaluate((id) => window.desktop.artifactRead(id), captured.artifact.id)).revisions,
  ).toEqual(captured.revisions);
});

test('comparison uses identical reviewed context, isolates a failed lane, and continues as a branch', async ({
  desktop,
}) => {
  const api = await localApi();
  const page = desktop.page;
  try {
    await enableCompatible(page, api.endpoint);
    const prepared = await page.evaluate(async () => {
      const note = await window.desktop.memorySave({
        projectId: null,
        title: 'Comparison context',
        text: 'COMPARISON_MARKER: same immutable material for every target.',
      });
      return window.desktop.memoryInclude(note.id, note.revision, null);
    });
    await tools(page, 'Memory');
    await page
      .getByRole('dialog', { name: 'Saved memory', exact: true })
      .getByRole('button', { name: 'Add to draft', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Saved memory', exact: true })).toHaveCount(0);
    await page.getByLabel('Message', { exact: true }).fill('Give a second opinion on this report');
    await tools(page, 'Compare models');
    const comparison = page.getByRole('dialog', { name: 'Compare models', exact: true });
    await comparison
      .getByLabel('Comparison provider 1', { exact: true })
      .selectOption('compatible');
    await comparison
      .getByLabel('Comparison provider 2', { exact: true })
      .selectOption('compatible');
    await comparison.getByLabel('Comparison model 1', { exact: true }).fill('fixture-one');
    await comparison.getByLabel('Comparison model 2', { exact: true }).fill('fixture-fail');
    expect(api.requests).toHaveLength(0);
    await comparison.getByRole('button', { name: 'Send to 2 models', exact: true }).click();
    await expect.poll(() => api.requests.length).toBe(2);
    const successful = comparison.getByRole('region', {
      name: 'Comparison 1: fixture-one',
      exact: true,
    });
    const failed = comparison.getByRole('region', {
      name: 'Comparison 2: fixture-fail',
      exact: true,
    });
    await expect(
      successful.getByRole('button', { name: 'Continue with this answer', exact: true }),
    ).toBeVisible();
    await expect(failed.getByRole('alert')).toContainText('Rate or usage limit');
    const payloads = api.requests.map(({ model: _model, ...request }) => request);
    expect(payloads[0]).toEqual(payloads[1]);
    expect(text(api.requests[0]).match(/COMPARISON_MARKER/g)).toHaveLength(1);
    const group = await page.evaluate(async () => (await window.desktop.comparisons())[0]);
    expect(group.members.map((m) => m.status)).toEqual(['completed', 'failed']);
    const successfulId = group.members[0].conversationId;
    await successful
      .getByRole('button', { name: 'Continue with this answer', exact: true })
      .click();
    await expect(comparison).toHaveCount(0);
    const branch = await page.evaluate(async () =>
      (await window.desktop.snapshot()).conversations.find((c) => c.parentConversationId)!,
    );
    expect(branch.parentConversationId).toBe(successfulId);
    expect(
      (
        await page.evaluate((id) => window.desktop.transcript(id), branch.id)
      )[0].contextSources!.some((s) => s.id === prepared.id),
    ).toBe(true);
    await desktop.restart();
    expect(
      (await desktop.page.evaluate((id) => window.desktop.comparison(id), group.id)).members.map(
        (m) => m.status,
      ),
    ).toEqual(['completed', 'failed']);
    expect(api.requests).toHaveLength(2);
  } finally {
    await api.close();
  }
});

test('native conversation JSON round-trip remaps source citations and artifact assets without changing captured content', async ({
  desktop,
}) => {
  const { page, app, data } = desktop;
  const imageId = randomUUID(),
    sourceId = randomUUID(),
    artifactId = randomUUID(),
    revisionId = randomUUID();
  const userId = randomUUID(),
    answerId = randomUUID();
  const createdAt = '2026-10-12T12:00:00.000Z';
  const token = `[[source:${sourceId}:1]]`;
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3mEAAAAASUVORK5CYII=',
    'base64',
  );
  const source = {
    id: sourceId,
    itemId: null,
    revision: 1,
    kind: 'web',
    title: 'Captured lighthouse page',
    text: 'The lighthouse opens on Sunday.',
    projectId: null,
    createdAt,
    source: {
      url: 'https://example.com/lighthouse',
      retrievedAt: createdAt,
      web: {
        requestedUrl: 'https://example.com/lighthouse',
        mime: 'text/html',
        hash: createHash('sha256').update('The lighthouse opens on Sunday.').digest('hex'),
        truncated: false,
        paragraphs: [{ id: 1, text: 'The lighthouse opens on Sunday.' }],
      },
    },
  };
  const sourcePath = join(data, 'sources-and-artifacts.json');
  await writeFile(
    sourcePath,
    JSON.stringify({
      format: 'multiclient-conversation',
      version: 2,
      conversation: {
        title: 'Portable source fixture',
        providerId: 'demo',
        model: '',
        mode: 'chat',
        tagNames: ['Research'],
      },
      messages: [
        {
          id: userId,
          role: 'user',
          providerId: 'demo',
          text: 'When does it open?',
          status: 'sent',
          createdAt,
          contextSources: [source],
          attachments: [
            {
              kind: 'image',
              assetId: imageId,
              path: 'lighthouse.png',
              name: 'lighthouse.png',
              mime: 'image/png',
              size: imageBytes.length,
              content: '',
            },
          ],
        },
        {
          id: answerId,
          role: 'assistant',
          providerId: 'demo',
          text: `It opens on Sunday. ${token}`,
          status: 'completed',
          createdAt,
          blocks: [{ id: 'answer', phase: 'answer', text: `It opens on Sunday. ${token}` }],
          sourceCitations: {
            sources: [sourceId],
            valid: [{ snapshotId: sourceId, paragraph: 1, token }],
            unresolved: [],
          },
        },
      ],
      artifacts: [
        {
          id: artifactId,
          title: 'Captured report',
          kind: 'markdown',
          language: '',
          headRevisionId: revisionId,
          revisions: [
            {
              id: revisionId,
              number: 1,
              parentRevisionId: null,
              source: `# Report\n\n![Lighthouse](media://assets/${imageId})`,
              author: 'user',
              createdAt,
              assetIds: [imageId],
            },
          ],
          references: [{ messageId: answerId, revisionId, relation: 'created' }],
        },
      ],
      assets: [
        {
          id: imageId,
          mime: 'image/png',
          type: 'image',
          size: imageBytes.length,
          hash: createHash('sha256').update(imageBytes).digest('hex'),
          data: imageBytes.toString('base64'),
        },
      ],
    }),
  );
  async function importConversation(path: string) {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path);
    await page.getByRole('button', { name: 'Archive & backups', exact: true }).click();
    await page.getByRole('button', { name: 'Import conversation JSON', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Archive & backups', exact: true })).toHaveCount(
      0,
    );
    return page.evaluate(async () => {
      const conversation = (await window.desktop.snapshot()).conversations[0];
      return window.desktop.conversation(conversation.id);
    });
  }
  const imported = await importConversation(sourcePath);
  const capturedSource = imported.messages[0].contextSources![0];
  expect(capturedSource.id).not.toBe(sourceId);
  expect(capturedSource.text).toBe(source.text);
  const capturedImage = imported.messages[0].attachments![0].assetId!;
  expect(capturedImage).not.toBe(imageId);
  const citation = imported.messages[1].sourceCitations!.valid[0];
  expect(citation.snapshotId).toBe(capturedSource.id);
  expect(citation.token).toBe(`[[source:${capturedSource.id}:1]]`);
  expect(imported.messages[1].text).toContain(citation.token);
  expect(imported.messages[1].blocks![0].text).toContain(citation.token);
  const artifactReference = imported.messages[1].artifactReferences![0];
  const importedArtifact = await page.evaluate(
    (id) => window.desktop.artifactRead(id),
    artifactReference.artifactId,
  );
  expect(importedArtifact.revisions[0].source).toContain(`media://assets/${capturedImage}`);
  expect(importedArtifact.revisions[0].assetIds).toEqual([capturedImage]);

  const exportPath = join(data, 'portable-roundtrip.json');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, exportPath);
  await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Conversation', exact: true });
  await options.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return (await readFile(exportPath)).length;
      } catch {
        return 0;
      }
    })
    .toBeGreaterThan(0);
  await options.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  expect(exported.assets).toHaveLength(1);
  expect(Buffer.from(exported.assets[0].data, 'base64')).toEqual(imageBytes);
  const roundtrip = await importConversation(exportPath);
  expect(roundtrip.messages[0].contextSources![0].id).not.toBe(capturedSource.id);
  expect(roundtrip.messages[0].contextSources![0].text).toBe(source.text);
  expect(roundtrip.messages[1].sourceCitations!.valid[0].snapshotId).toBe(
    roundtrip.messages[0].contextSources![0].id,
  );
  expect(roundtrip.messages[1].artifactReferences![0].artifactId).not.toBe(
    artifactReference.artifactId,
  );
  expect(
    (
      await page.evaluate((id) => window.desktop.conversationTags(id), roundtrip.conversation.id)
    ).map((tag) => tag.name),
  ).toEqual(['Research']);
});

test('context tools remain keyboard-accessible at 800×600 and 200% zoom without losing the draft', async ({
  desktop,
}) => {
  const { page, app } = desktop;
  const errors = recordErrors(page);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(800, 600);
    window.webContents.setZoomFactor(2);
  });
  await expect.poll(() => page.evaluate(() => innerWidth <= 400 && innerHeight <= 300)).toBe(true);
  await page.getByLabel('Message', { exact: true }).focus();
  await page.keyboard.type('Keep this keyboard draft.');
  async function tabTo(target: ReturnType<Page['getByRole']>) {
    for (let n = 0; n < 40; n++) {
      if (await target.evaluate((element) => element === document.activeElement)) return;
      await page.keyboard.press('Tab');
    }
    await expect(target).toBeFocused();
  }
  const tools = page.getByRole('button', { name: 'Add context and tools', exact: true });
  await tabTo(tools);
  await page.keyboard.press('Enter');
  const chooser = page.getByRole('dialog', { name: 'Context and tools', exact: true });
  await expect(chooser).toBeVisible();
  const memory = chooser.getByRole('button', { name: 'Memory', exact: true });
  await tabTo(memory);
  expect(
    await memory.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= innerWidth &&
        bounds.bottom <= innerHeight
      );
    }),
  ).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Saved memory', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Saved memory', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this keyboard draft.',
  );
  expect((await page.evaluate(() => window.desktop.snapshot())).conversations).toHaveLength(0);
  expect(errors).toEqual([]);
});
