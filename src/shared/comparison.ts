import { z } from 'zod';
import { contextRefSchema, type ContextRef } from './context';
import { artifactReferenceSchema, type ArtifactReference } from './artifacts';
import type { Attachment, Conversation, ErrorInfo, TurnStatus } from './types';

export type ComparisonTarget = { providerId: 'openai' | 'anthropic' | 'compatible'; model: string };
export type ComparisonInput = {
  requestId: string;
  title?: string;
  sourceConversationId?: string;
  projectId?: string;
  workspaceId?: string;
  historyMessageIds?: string[];
  text: string;
  attachments: Attachment[];
  contextRefs?: ContextRef[];
  excludedContextSnapshotIds?: string[];
  artifactReferences?: ArtifactReference[];
  targets: ComparisonTarget[];
  pdfDelivery: 'native' | 'text';
};
export type ComparisonMember = ComparisonTarget & {
  conversationId: string;
  requestId: string;
  configurationRevision: string;
  status: TurnStatus | 'prepared';
  text: string;
  error?: string;
  errorInfo?: ErrorInfo;
  messageId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};
export type ComparisonGroup = {
  id: string;
  title: string;
  createdAt: string;
  sourceConversationId: string | null;
  state: 'prepared' | 'started';
  contextCharacters: number;
  members: ComparisonMember[];
};
export type ComparisonApi = {
  prepareComparison(input: ComparisonInput): Promise<ComparisonGroup>;
  startComparison(id: string): Promise<ComparisonGroup>;
  comparisons(): Promise<ComparisonGroup[]>;
  comparison(id: string): Promise<ComparisonGroup>;
  cancelComparison(id: string, conversationId?: string): Promise<void>;
  continueComparison(id: string, conversationId: string): Promise<Conversation>;
};
const uuid = z.string().uuid();
const target = z
  .object({
    providerId: z.enum(['openai', 'anthropic', 'compatible']),
    model: z.string().trim().min(1).max(200),
  })
  .strict();
export function comparisonRoutes(attachmentSchema: z.ZodType<Attachment>) {
  return {
    prepareComparison: z
      .object({
        requestId: uuid,
        title: z.string().trim().min(1).max(160).optional(),
        sourceConversationId: uuid.optional(),
        projectId: uuid.optional(),
        workspaceId: uuid.optional(),
        historyMessageIds: z.array(uuid).max(10000).optional(),
        text: z.string().trim().min(1).max(100000),
        attachments: z.array(attachmentSchema).max(10),
        contextRefs: z.array(contextRefSchema).max(30).optional(),
        excludedContextSnapshotIds: z.array(uuid).max(1000).optional(),
        artifactReferences: z.array(artifactReferenceSchema).max(10).optional(),
        targets: z
          .array(target)
          .min(2)
          .max(3)
          .refine(
            (targets) =>
              new Set(targets.map((t) => `${t.providerId}:${t.model}`)).size === targets.length,
            'Choose distinct provider/model targets.',
          ),
        pdfDelivery: z.enum(['native', 'text']),
      })
      .strict(),
    startComparison: z.object({ id: uuid }).strict(),
    comparisons: z.object({}).strict(),
    comparison: z.object({ id: uuid }).strict(),
    cancelComparison: z.object({ id: uuid, conversationId: uuid.optional() }).strict(),
    continueComparison: z.object({ id: uuid, conversationId: uuid }).strict(),
  };
}
