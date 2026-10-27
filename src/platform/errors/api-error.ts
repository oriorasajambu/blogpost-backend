export interface FieldIssue {
  location: 'header' | 'path' | 'query' | 'body';
  field: string;
  code: string;
  params: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly description: string,
    public readonly fieldErrors: FieldIssue[] = [],
    public readonly context: Record<string, unknown> | null = null,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}
