import type { OrganizationApi } from '../../shared/organization';

export function createOrganizationApi(
  invoke: (route: string, input?: unknown) => Promise<any>,
): OrganizationApi {
  return {
    tags: () => invoke('tags'),
    createTag: (name) => invoke('createTag', { name }),
    renameTag: (id, name) => invoke('renameTag', { id, name }),
    deleteTag: (id) => invoke('deleteTag', { id }),
    conversationTags: (conversationId) => invoke('conversationTags', { conversationId }),
    setConversationTags: (conversationId, tagIds) =>
      invoke('setConversationTags', { conversationId, tagIds }),
    promptTemplates: (projectId) => invoke('promptTemplates', { projectId }),
    savePromptTemplate: (input) => invoke('savePromptTemplate', input),
    deletePromptTemplate: (id, revision) => invoke('deletePromptTemplate', { id, revision }),
  };
}
