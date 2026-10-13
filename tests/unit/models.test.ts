import { describe, expect, it } from 'vitest';
import { supportsNativeAttachment } from '../../src/shared/models';

describe('native attachment model admission', () => {
  it('preserves documented current Claude families and dated IDs', () => {
    for (const model of [
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-opus-4-5-20251101',
      'claude-opus-4-6',
      'claude-opus-4-8',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-5-5',
    ]) {
      expect(supportsNativeAttachment('anthropic', model, 'image'), model).toBe(true);
      expect(supportsNativeAttachment('anthropic', model, 'pdf'), model).toBe(true);
    }
  });

  it('does not infer current native support from retired Claude 3 IDs or custom prefixes', () => {
    for (const model of [
      'claude-3-haiku-20240307',
      'claude-3-sonnet-20240229',
      'claude-3-opus-20240229',
      'claude-3-5-haiku-20241022',
      'claude-3-5-sonnet-20240620',
      'claude-3-7-sonnet-20250219',
      'claude-opus-4-1-20250805',
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-sonnet-custom',
      'claude-sonnet-4-custom',
      'claude-sonnet-99',
      'claude-sonnet-4-99',
      'claude-30-custom',
    ]) {
      expect(supportsNativeAttachment('anthropic', model, 'image'), model).toBe(false);
      expect(supportsNativeAttachment('anthropic', model, 'pdf'), model).toBe(false);
    }
  });

  it('preserves OpenAI vision families and rejects audio, text-only and compatible inputs', () => {
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5.4', 'gpt-6']) {
      for (const kind of ['image', 'pdf'] as const) {
        expect(supportsNativeAttachment('openai', model, kind), model).toBe(true);
        expect(supportsNativeAttachment('compatible', model, kind), model).toBe(false);
      }
    }
    for (const model of [
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4o-audio-preview',
      'gpt-4o-mini-search-preview',
    ]) {
      expect(supportsNativeAttachment('openai', model, 'image'), model).toBe(false);
      expect(supportsNativeAttachment('openai', model, 'pdf'), model).toBe(false);
    }
  });
});
