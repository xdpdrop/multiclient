import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isLocalAssetUrl, parseFileReference } from '../../src/renderer/components/file-reference';
import { Markdown } from '../../src/renderer/components/Markdown';
import { ModeControl } from '../../src/renderer/components/ModeControl';
import { capabilities } from '../../src/shared/defaults';
import { filterPickerOptions } from '../../src/renderer/components/Picker';
import { hasQuestionAnswer, QuestionFields } from '../../src/renderer/components/QuestionFields';

describe('workspace file references', () => {
  it('accepts local references with line numbers and Windows or POSIX project paths', () => {
    expect(parseFileReference('src/file.ts:12:3', 'C:\\project')).toEqual({
      path: 'src/file.ts',
      line: 12,
    });
    expect(parseFileReference('C:/project/src/file.ts#L12-L20', 'C:\\project')).toEqual({
      path: 'src/file.ts',
      line: 12,
    });
    expect(parseFileReference('file:///C:/project/file%20name.ts:2', 'C:\\project')).toEqual({
      path: 'file name.ts',
      line: 2,
    });
    expect(
      parseFileReference('file:///home/me/project/src/index.ts#L9', '/home/me/project'),
    ).toEqual({ path: 'src/index.ts', line: 9 });
  });
  it('refuses other workspaces, traversal, unsupported schemes and malformed positions', () => {
    for (const href of [
      '../private.txt',
      '%2E%2E/private.txt',
      'C:/project-other/file.ts',
      'javascript:alert(1)',
      'https://example.com/file.ts',
      '//server/file.ts',
      'file://remote/file.ts',
      'file.ts:0',
      'file.ts#L9007199254740993',
      '%XX',
      'file.ts?command=anything',
    ])
      expect(parseFileReference(href, 'C:\\project')).toBeNull();
  });
});

describe('typed question answers', () => {
  const question = {
    id: 'choice',
    prompt: 'Pick tools',
    options: ['First', 'Second'],
    multiple: true,
    allowFreeText: false,
  };
  it('requires an actual selected choice and rejects unsupported or excess choices', () => {
    expect(hasQuestionAnswer(question, { selected: [], text: '' })).toBe(false);
    expect(hasQuestionAnswer(question, { selected: [], text: '[]' })).toBe(false);
    expect(hasQuestionAnswer(question, { selected: ['First', 'Second'], text: '' })).toBe(true);
    expect(hasQuestionAnswer(question, { selected: ['Unknown'], text: '' })).toBe(false);
    expect(
      hasQuestionAnswer(
        { ...question, multiple: false },
        { selected: ['First', 'Second'], text: '' },
      ),
    ).toBe(false);
    expect(
      hasQuestionAnswer({ ...question, allowFreeText: true }, { selected: [], text: 'My choice' }),
    ).toBe(true);
  });
  it('renders multiple choices as labelled checkboxes even when free text is allowed', () => {
    const html = renderToStaticMarkup(
      createElement(QuestionFields, {
        questions: [{ ...question, allowFreeText: true }],
        answers: { choice: { selected: ['First'], text: '' } },
        onChange: () => {},
      }),
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('<legend>Pick tools</legend>');
    expect(html).toContain('Other answer');
    expect(html).toContain('checked=""');
  });
});

it('renders only local asset images and leaves remote or injected images inert', () => {
  const asset = 'media://assets/12345678-1234-4234-8234-123456789012';
  expect(isLocalAssetUrl(asset)).toBe(true);
  for (const url of [
    asset + '?redirect=remote',
    asset + '/extra',
    'media://other/12345678-1234-4234-8234-123456789012',
    'https://example.invalid/tracker',
    'data:image/png;base64,AA==',
  ])
    expect(isLocalAssetUrl(url)).toBe(false);
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: `![local](${asset}) ![remote](https://example.invalid/tracker) <img src="https://example.invalid/injected">`,
    }),
  );
  expect(html).toContain(`src="${asset}"`);
  expect(html).toContain('[Image: remote]');
  expect(html).not.toContain('src="https://');
});

it('uses advertised mode gates instead of showing unverified editing options', () => {
  const available = capabilities('cursor').modes.filter((mode) => mode.workspaceAccess === 'read');
  const html = renderToStaticMarkup(
    createElement(ModeControl, {
      provider: 'cursor',
      mode: 'ask',
      disabled: false,
      available,
      onChange: () => {},
    }),
  );
  expect(html).toContain('aria-label="Mode"');
  expect(html).not.toContain('aria-label="Code"');
  expect(html).not.toContain('Bypass approvals');
  const recovery = renderToStaticMarkup(
    createElement(ModeControl, {
      provider: 'cursor',
      mode: 'code',
      disabled: false,
      available: capabilities('cursor').modes.filter((mode) => mode.id === 'ask'),
      onChange: () => {},
    }),
  );
  expect(recovery).toContain('aria-label="Mode"');
  expect(recovery).toContain('Code (unavailable)');
  expect(recovery).toContain('Choose an available mode');
  expect(recovery).not.toContain('aria-label="Permissions"');
});

it('filters picker labels, model IDs and descriptions while preserving option order', () => {
  const options = [
    { value: '', label: 'Default model', description: 'Provider preference' },
    { value: 'model-fast-v2', label: 'Fast model' },
    { value: 'model-deep', label: 'Deep model', description: 'Large context' },
  ];
  expect(filterPickerOptions(options, '  FAST-V2 ')).toEqual([options[1]]);
  expect(filterPickerOptions(options, 'context')).toEqual([options[2]]);
  expect(filterPickerOptions(options, 'model')).toEqual(options);
  expect(filterPickerOptions(options, '   ')).toBe(options);
  expect(filterPickerOptions(options, 'unknown')).toEqual([]);
});

it('only makes audited saved-source markers inspectable and leaves code and forged markers inert', () => {
  const id = '12345678-1234-4234-8234-123456789012';
  const token = `[[source:${id}:1]]`;
  const forged = `[[source:${id}:99]]`;
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: `${token} ${forged}\n\n\`${token}\`\n\n\`\`\`text\n${token}\n\`\`\`\n\n[${token}](https://example.invalid)\n\n[${token}][reference]\n\n[reference]: https://example.invalid\n\n\\[${token.slice(1)}`,
      sourceCitations: {
        valid: [{ snapshotId: id, paragraph: 1, token }],
        unresolved: [forged],
        sources: [id],
      },
    }),
  );
  expect(html.match(/title="Inspect captured source paragraph"/g)).toHaveLength(1);
  expect(html).toContain(forged);
  expect(html).toContain(`<code>${token}</code>`);
  expect(html).not.toContain('href="captured-source:');
});

it('offers saving code as an artifact only when an explicit completed-message origin is supplied', () => {
  const text = '```html\n<h1>Report</h1>\n```';
  expect(renderToStaticMarkup(createElement(Markdown, { text }))).not.toContain('Save as artifact');
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text,
      artifactOrigin: {
        conversationId: '12345678-1234-4234-8234-123456789012',
        messageId: '22345678-1234-4234-8234-123456789012',
      },
    }),
  );
  expect(html).toContain('Save as artifact');
  expect(html).toContain('&lt;h1&gt;Report&lt;/h1&gt;');
  expect(html).not.toContain('<h1>Report</h1>');
});

it('preserves the complete response as literal text for excessive complete or incomplete citation markers', () => {
  for (const marker of ['[[source:12345678-1234-4234-8234-123456789012:1]]', '[[source:']) {
    const text = marker.repeat(50000);
    const html = renderToStaticMarkup(createElement(Markdown, { text }));
    expect(html).toContain('Formatting limited');
    expect(html).toContain(text);
    expect(html).not.toContain('Inspect captured source paragraph');
  }
});
