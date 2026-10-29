// Small wrapper around fetch. It always sends the session cookie and turns API errors into readable messages.

export interface CurrentUser {
  id: number;
  username: string;
  fullName: string;
  role: 'MasterAdmin' | 'Admin' | 'Editor' | 'Viewer';
  accountId: number | null;
  accountName?: string | null;
}

export interface FieldProblem {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: FieldProblem[] = [],
  ) {
    super(message);
  }
}

export interface SignUpInput {
  accountName: string;
  fullName: string;
  username: string;
  password: string;
}

// Which sign-in options the administrator has turned on.
export interface AuthOptions {
  selfSignupEnabled: boolean;
  googleEnabled: boolean;
  appName?: string;
  brandColor?: string;
}

// The office the Master Admin is working on. Normal users always work on their own office, and the server ignores this.
let scopeAccountId: number | null = null;
export function setScopeAccountId(id: number | null): void {
  scopeAccountId = id;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      // For uploads the browser sets the multipart Content-Type (with its boundary) itself.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(scopeAccountId ? { 'X-Account-Id': String(scopeAccountId) } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error ?? `Request failed with status ${response.status}.`,
      Array.isArray(body.details) ? body.details : [],
    );
  }
  return body as T;
}

// Turns { a: 1, b: undefined } into "?a=1", skipping empty values.
function queryString(params?: Record<string, string | number | boolean | null | undefined>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// General helpers used by every page.
export const http = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | null | undefined>) => request<T>(path + queryString(params)),
  post: <T = void>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T = void>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

// A readable message for any error thrown by the helpers above.
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Cannot reach the server. Is the backend running?';
}

// Where the Google button sends the browser. The backend starts the Google sign-in from this address.
export function googleStartUrl(mode: 'signin' | 'signup', accountName?: string): string {
  const params = new URLSearchParams({ mode });
  if (accountName) params.set('accountName', accountName);
  return `/api/auth/google/start?${params.toString()}`;
}

// Address of a stored image or file. The cookie authorises it; the office is checked on the server.
export function fileUrl(fileId: number): string {
  return `/api/files/${fileId}`;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ user: CurrentUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  signup: (input: SignUpInput) =>
    request<{ user: CurrentUser }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  authOptions: () => request<AuthOptions>('/auth/options'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: CurrentUser }>('/auth/me'),
  health: () => request<{ status: string; database: string }>('/health'),
};
