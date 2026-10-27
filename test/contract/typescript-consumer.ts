import type {
  components,
  operations,
} from '../../contracts/generated/typescript/api-v1.js';

type CreateRequest =
  operations['createPost']['requestBody']['content']['application/json'];
type CreateResult =
  operations['createPost']['responses'][201]['content']['application/json'];
type PublicArticle =
  operations['getPublicPost']['responses'][200]['content']['application/json'];
type VersionFailure =
  operations['savePostDraft']['responses'][412]['content']['application/json'];

export function newDraft(clientDraftId: string): CreateRequest {
  return {
    clientDraftId,
    draft: {
      title: '',
      summary: '',
      markdown: '',
      categoryId: null,
      tagIds: [],
      coverMediaId: null,
    },
  };
}
export function savedRevision(response: CreateResult): string | null {
  return response.data.workingRevisionId;
}
export function authorName(response: PublicArticle): string {
  return response.data.author.displayName;
}
export function machineCode(response: VersionFailure): string {
  return response.error.code;
}
export function safeRole(value: string): components['schemas']['Role'] | null {
  return value === 'AUTHOR' || value === 'EDITOR' || value === 'ADMIN'
    ? value
    : null;
}
