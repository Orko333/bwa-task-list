import axios, { AxiosError } from 'axios';

/**
 * Codes the API attaches to the errors it raises on purpose. Anything else is
 * either a validation failure or a transport problem.
 */
export type ApiErrorCode =
  | 'TASK_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'MAX_DEPTH_EXCEEDED'
  | 'CYCLIC_MOVE';

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: ApiErrorCode | null;

  constructor(message: string, status: number | null, code: ApiErrorCode | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorBody {
  message?: string | string[];
  code?: ApiErrorCode;
}

export const http = axios.create({
  baseURL: `${apiOrigin()}/api`,
  // A free Render instance stops after 15 minutes idle and takes the better part
  // of a minute to come back, so the first request of a visit can be very slow.
  // Giving up before then would show a connection error on a server that is
  // simply waking up.
  timeout: 75_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Render hands the API's address over as a bare host, so the scheme is added
 * here rather than being duplicated across every deployment's settings.
 */
function apiOrigin(): string {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) return 'http://localhost:3000';

  return /^https?:\/\//.test(configured) ? configured : `https://${configured}`;
}

/**
 * Turns every failure into an {@link ApiError} carrying a sentence the UI can
 * show as-is. Without this each caller would have to decide what an axios error
 * means, and the answer would drift between them.
 */
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (!(error instanceof AxiosError)) {
      return Promise.reject(new ApiError('Something went wrong.', null, null));
    }

    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new ApiError('The server took too long to answer.', null, null));
    }


    const response = error.response;
    if (!response) {
      return Promise.reject(
        new ApiError('Cannot reach the server. Check your connection.', null, null),
      );
    }

    const body = response.data as ApiErrorBody | undefined;
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;

    return Promise.reject(
      new ApiError(message ?? fallbackMessage(response.status), response.status, body?.code ?? null),
    );
  },
);

function fallbackMessage(status: number): string {
  if (status === 429) return 'Too many changes at once. Give it a moment.';
  if (status >= 500) return 'The server ran into a problem.';
  return 'The change was rejected.';
}
