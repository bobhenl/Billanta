import { ApiError } from './api-client';

/** A short, displayable reason from a failed `apiFetch`: the backend's snake_case `error` code, its validation message, or the HTTP status. */
export function backendMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body) as { message?: unknown; error?: unknown };
      const code = typeof body.error === 'string' && /^[a-z_]+$/.test(body.error) ? body.error : null;
      if (code) return code;
      const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      if (typeof message === 'string') return message;
    } catch {
      // not JSON
    }
    return `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}
