import { test, expect, choose } from './fixtures';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('Ask to revise sends a pinned artifact to a real local API and saves only the reviewed proposal as a new revision', async ({
  desktop,
}) => {
  const { page } = desktop;
  const requests: { model: string; messages: { role: string; content: unknown }[] }[] = [];
  const proposedSource = '# Revised report\n\nThe reviewed replacement keeps the original goal.';
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'artifact-fixture' }] }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404);
      response.end();
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.setHeader('content-type', 'text/event-stream');
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: `Here is the revised report.\n\n\`\`\`markdown\n${proposedSource}\n\`\`\`` }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Local artifact API fixture unavailable.');
  try {
    const original = await page.evaluate(async (endpoint) => {
      const connection = (await window.desktop.snapshot()).connections.find(
        (c) => c.id === 'compatible',
      )!;
      await window.desktop.saveConnection({
        ...connection,
        endpoint,
        model: 'artifact-fixture',
        enabled: true,
      });
      return window.desktop.artifactCreate({
        title: 'Revision journey',
        kind: 'markdown',
        source: '# Original report\n\nARTIFACT_ORIGINAL_MARKER: preserve this goal.',
      });
    }, `http://127.0.0.1:${address.port}/v1`);
    await choose(page, 'Provider', 'Compatible API');
    await page.getByRole('button', { name: 'Artifacts', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Artifacts', exact: true });
    await library.getByLabel('Choose artifact', { exact: true }).selectOption(original.artifact.id);
    await library
      .getByRole('button', { name: 'Ask to revise saved artifact', exact: true })
      .click();
    await expect(library).toHaveCount(0);
    const prompt = page.getByLabel('Message', { exact: true });
    await expect(prompt).toHaveValue(
      'Revise the attached markdown artifact "Revision journey". Describe the changes you want here. Return the complete replacement source in one fenced block.',
    );
    await expect(
      page.getByRole('button', {
        name: `Artifact revision ${original.artifact.headRevisionId.slice(0, 8)}`,
        exact: true,
      }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
    await prompt.fill(
      'Revise the attached markdown report: change the heading to Revised report and retain its goal. Return the complete replacement source in one fenced block.',
    );
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const answer = page.locator('article[data-message-role="assistant"]').last();
    await expect(
      answer.getByRole('button', { name: 'Review proposed revision', exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe('artifact-fixture');
    const requestText = requests[0].messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    expect(requestText).toContain(original.revisions[0].source);
    expect(requestText).toContain(original.artifact.headRevisionId);
    expect(requestText).toContain(original.artifact.id);
    const beforeReview = await page.evaluate(
      (id) => window.desktop.artifactRead(id),
      original.artifact.id,
    );
    expect(beforeReview.revisions).toEqual(original.revisions);
    await answer.getByRole('button', { name: 'Review proposed revision', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Artifacts', exact: true });
    await expect(review.getByLabel('Artifact source', { exact: true })).toHaveValue(proposedSource);
    await expect(
      review.getByRole('region', { name: 'Artifact source comparison', exact: true }),
    ).toContainText(original.revisions[0].source);
    const awaitingAcceptance = await page.evaluate(
      (id) => window.desktop.artifactRead(id),
      original.artifact.id,
    );
    expect(awaitingAcceptance.artifact.headRevisionId).toBe(original.artifact.headRevisionId);
    await review.getByRole('button', { name: 'Save revision', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('New revision saved.');
    const accepted = await page.evaluate(async (artifactId) => {
      const conversation = (await window.desktop.snapshot()).conversations[0];
      return {
        view: await window.desktop.artifactRead(artifactId),
        messages: await window.desktop.transcript(conversation.id),
      };
    }, original.artifact.id);
    expect(accepted.view.revisions).toHaveLength(2);
    expect(accepted.view.revisions[0]).toMatchObject({
      source: proposedSource,
      author: 'model',
      parentRevisionId: original.artifact.headRevisionId,
    });
    expect(accepted.view.revisions[1]).toEqual(original.revisions[0]);
    expect(accepted.view.revisions[0].id).not.toBe(original.artifact.headRevisionId);
    const user = accepted.messages.find((message) => message.role === 'user')!;
    const assistant = accepted.messages.find((message) => message.role === 'assistant')!;
    expect(user.artifactReferences).toEqual([
      expect.objectContaining({
        artifactId: original.artifact.id,
        revisionId: original.artifact.headRevisionId,
      }),
    ]);
    expect(accepted.view.revisions[0].sourceMessageId).toBe(assistant.id);
    expect(requests).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Source and Preview tabs keep the working draft and open isolated saved revisions with keyboard controls', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  const created = await page.evaluate(async () => {
    const view = await window.desktop.artifactCreate({
      title: 'Tabbed document',
      kind: 'markdown',
      source: '# First saved revision',
    });
    const next = await window.desktop.artifactCommit({
      id: view.artifact.id,
      expectedHeadRevisionId: view.artifact.headRevisionId,
      source: '# Second saved revision',
    });
    if (!next.ok) throw new Error('Fixture revision conflict');
    return next.view;
  });
  await page.getByRole('button', { name: 'Artifacts', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Artifacts', exact: true });
  await editor.getByLabel('Choose artifact', { exact: true }).selectOption(created.artifact.id);
  const sourceTab = editor.getByRole('tab', { name: 'Source', exact: true }),
    previewTab = editor.getByRole('tab', { name: 'Preview', exact: true });
  await expect(sourceTab).toHaveAttribute('aria-selected', 'true');
  await editor
    .getByLabel('Artifact source', { exact: true })
    .fill('# Working draft kept across tabs');
  await sourceTab.focus();
  await sourceTab.press('ArrowRight');
  await expect(previewTab).toBeFocused();
  await expect(sourceTab).toHaveAttribute('aria-selected', 'true');
  const firstWindow = app.waitForEvent('window');
  await previewTab.press('Enter');
  const latestPreview = await firstWindow;
  await expect(previewTab).toHaveAttribute('aria-selected', 'true');
  await expect(editor.getByRole('tabpanel', { name: 'Preview', exact: true })).toContainText(
    'saved revision 2',
  );
  await expect(
    latestPreview.getByRole('heading', { name: 'Second saved revision', exact: true }),
  ).toBeVisible();
  await expect(
    latestPreview.getByRole('heading', { name: 'Working draft kept across tabs', exact: true }),
  ).toHaveCount(0);
  await latestPreview.close();
  const revision = editor.getByLabel('Artifact revision', { exact: true });
  const olderWindow = app.waitForEvent('window');
  await revision.focus();
  await revision.press('ArrowDown');
  await revision.press('Enter');
  const olderPreview = await olderWindow;
  await expect(revision).toHaveValue(created.revisions[1].id);
  await expect(
    olderPreview.getByRole('heading', { name: 'First saved revision', exact: true }),
  ).toBeVisible();
  await olderPreview.close();
  await previewTab.focus();
  await previewTab.press('Home');
  await expect(sourceTab).toBeFocused();
  await sourceTab.press('Enter');
  await expect(sourceTab).toHaveAttribute('aria-selected', 'true');
  await expect(editor.getByLabel('Artifact source', { exact: true })).toHaveValue(
    '# Working draft kept across tabs',
  );
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await window.desktop.artifactRead(id)).draft?.source,
        created.artifact.id,
      ),
    )
    .toBe('# Working draft kept across tabs');
  expect((await page.evaluate(() => window.desktop.snapshot())).conversations).toHaveLength(0);
});

test('artifact revisions recover drafts and export/import without inference; static previews cannot access scripts/network/desktop', async ({
  desktop,
}) => {
  const { app, page, data } = desktop;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end('NETWORK_SENTINEL');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const original = await page.evaluate(async (port) => {
      const view = await window.desktop.artifactCreate({
        title: 'Static security fixture',
        kind: 'html',
        source: `<h1>Static artifact fixture</h1><script>window.ARTIFACT_SCRIPT_SENTINEL=1;fetch('http://127.0.0.1:${port}/script');window.open('http://127.0.0.1:${port}/popup')</script><img src="http://127.0.0.1:${port}/image"><style>@import url(http://127.0.0.1:${port}/style);body{background-image:url(http://127.0.0.1:${port}/css)}</style><iframe src="file:///C:/Windows/win.ini"></iframe><form action="http://127.0.0.1:${port}/form"><input name="secret" value="test"></form>`,
      });
      await window.desktop.artifactSaveDraft({
        id: view.artifact.id,
        baseRevisionId: view.artifact.headRevisionId,
        source: 'Recovered artifact draft',
        expectedGeneration: 0,
      });
      return view;
    }, port);
    const previewPromise = app.waitForEvent('window');
    await page.evaluate((id) => window.desktop.artifactPreview({ id }), original.artifact.id);
    const preview = await previewPromise;
    await expect(preview.getByRole('heading', { name: 'Static artifact fixture' })).toBeVisible();
    expect(
      await preview.evaluate(() => ({
        desktop: typeof (window as any).desktop,
        sentinel: (window as any).ARTIFACT_SCRIPT_SENTINEL,
      })),
    ).toEqual({ desktop: 'undefined', sentinel: undefined });
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('Static preview'))!;
      const p = (w.webContents as any).getLastWebPreferences();
      return {
        javascript: p.javascript,
        nodeIntegration: p.nodeIntegration,
        contextIsolation: p.contextIsolation,
        sandbox: p.sandbox,
      };
    });
    expect(preferences).toEqual({
      javascript: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    });
    expect(requests).toBe(0);
    await preview.close();
    await desktop.restart();
    const recovered = await desktop.page.evaluate(
      (id) => window.desktop.artifactRead(id),
      original.artifact.id,
    );
    expect(recovered.draft?.source).toBe('Recovered artifact draft');
    const commit = await desktop.page.evaluate(
      async (view) =>
        window.desktop.artifactCommit({
          id: view.artifact.id,
          expectedHeadRevisionId: view.artifact.headRevisionId,
          source: view.draft!.source,
        }),
      recovered,
    );
    expect(commit.ok).toBe(true);
    const exported = join(data, 'artifact.json');
    await desktop.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, exported);
    await desktop.page.evaluate(
      (id) => window.desktop.artifactExport({ id, format: 'json' }),
      original.artifact.id,
    );
    const raw = JSON.parse(await readFile(exported, 'utf8'));
    expect(raw.artifact.revisions).toHaveLength(2);
    await desktop.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, exported);
    const imported = await desktop.page.evaluate(() => window.desktop.artifactImport());
    expect(imported!.artifact.id).not.toBe(original.artifact.id);
    expect(imported!.revisions[0].source).toBe('Recovered artifact draft');
    expect((await desktop.page.evaluate(() => window.desktop.snapshot())).activeTurns).toHaveLength(
      0,
    );
    expect(
      (await desktop.page.evaluate(() => window.desktop.snapshot())).conversations,
    ).toHaveLength(0);
    const diagram = await desktop.page.evaluate(() =>
      window.desktop.artifactCreate({
        title: 'Diagram fixture',
        kind: 'mermaid',
        source: 'graph TD\nA[Start] --> B[Done]',
      }),
    );
    const svgPath = join(data, 'diagram.svg');
    await desktop.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, svgPath);
    await desktop.page.evaluate(
      (id) => window.desktop.artifactExport({ id, format: 'svg' }),
      diagram.artifact.id,
    );
    expect(await readFile(svgPath, 'utf8')).toContain('<svg');
    expect(requests).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
