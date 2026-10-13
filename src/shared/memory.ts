import { z } from 'zod';
import type { ContextSnapshot } from './context';

const uuid = z.string().uuid();
export const memorySourceSchema = z
  .object({
    conversationId: uuid,
    messageId: uuid,
  })
  .strict();
export const memorySaveSchema = z
  .object({
    id: uuid.optional(),
    expectedRevision: z.number().int().positive().optional(),
    projectId: uuid.nullable(),
    title: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(10000),
    includeNewChats: z.boolean().default(false),
    source: memorySourceSchema.optional(),
  })
  .strict()
  .refine((input) => !!input.id === !!input.expectedRevision, {
    message: 'Editing memory requires its current revision.',
  });
export type MemorySaveInput = z.input<typeof memorySaveSchema>;
export type MemorySource = z.infer<typeof memorySourceSchema>;
export type MemoryNote = {
  id: string;
  revision: number;
  projectId: string | null;
  title: string;
  text: string;
  includeNewChats: boolean;
  source?: MemorySource;
  updatedAt: string;
};
export const memoryRoutes = {
  memoryList: z.object({ projectId: uuid.nullable() }).strict(),
  memorySave: memorySaveSchema,
  memoryDelete: z.object({ id: uuid, expectedRevision: z.number().int().positive() }).strict(),
  memoryInclude: z
    .object({
      id: uuid,
      expectedRevision: z.number().int().positive(),
      projectId: uuid.nullable(),
    })
    .strict(),
  memoryDefaults: z.object({ projectId: uuid.nullable() }).strict(),
};
export type MemoryApi = {
  memoryList(projectId: string | null): Promise<MemoryNote[]>;
  memorySave(input: MemorySaveInput): Promise<MemoryNote>;
  memoryDelete(id: string, expectedRevision: number): Promise<void>;
  memoryInclude(
    id: string,
    expectedRevision: number,
    projectId: string | null,
  ): Promise<ContextSnapshot>;
  memoryDefaults(projectId: string | null): Promise<ContextSnapshot[]>;
};
