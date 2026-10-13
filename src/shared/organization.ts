import { z } from 'zod';

export type ConversationTag = { id: string; name: string };
export type PromptTemplate = {
  id: string;
  name: string;
  body: string;
  projectId: string | null;
  revision: number;
  updatedAt: string;
};
export type PromptTemplateInput = {
  id?: string;
  revision?: number;
  name: string;
  body: string;
  projectId?: string | null;
};
export type OrganizationApi = {
  tags(): Promise<ConversationTag[]>;
  createTag(name: string): Promise<ConversationTag>;
  renameTag(id: string, name: string): Promise<ConversationTag>;
  deleteTag(id: string): Promise<void>;
  conversationTags(conversationId: string): Promise<ConversationTag[]>;
  setConversationTags(conversationId: string, tagIds: string[]): Promise<void>;
  promptTemplates(projectId?: string): Promise<PromptTemplate[]>;
  savePromptTemplate(input: PromptTemplateInput): Promise<PromptTemplate>;
  deletePromptTemplate(id: string, revision: number): Promise<void>;
};

const id = z.string().uuid();
export const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const tagNamesSchema = z.array(tagNameSchema).max(20);
export const promptTemplateInputSchema = z
  .object({
    id: id.optional(),
    revision: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(100),
    body: z
      .string()
      .min(1)
      .max(100000)
      .refine((value) => !!value.trim(), 'Enter prompt text.'),
    projectId: id.nullable().optional(),
  })
  .strict()
  .refine((value) => !!value.id === !!value.revision, 'Editing requires a template revision.');
export const organizationRoutes = {
  tags: z.object({}).strict(),
  createTag: z.object({ name: tagNameSchema }).strict(),
  renameTag: z.object({ id, name: tagNameSchema }).strict(),
  deleteTag: z.object({ id }).strict(),
  conversationTags: z.object({ conversationId: id }).strict(),
  setConversationTags: z.object({ conversationId: id, tagIds: z.array(id).max(20) }).strict(),
  promptTemplates: z.object({ projectId: id.optional() }).strict(),
  savePromptTemplate: promptTemplateInputSchema,
  deletePromptTemplate: z.object({ id, revision: z.number().int().positive() }).strict(),
};
