export type ApiErrorStatus = 400 | 401 | 403 | 404 | 500;

export type ApiError = { error: { status: ApiErrorStatus; code: string; message: string } };

export function apiError(status: ApiErrorStatus, code: string, message: string): ApiError {
  return { error: { status, code, message } };
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "error" in value
    && typeof (value as ApiError).error?.status === "number";
}

/** Every answer is fresh: a revenue system must never get a cached list from a proxy. */
export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse({ error }: ApiError): Response {
  return apiJson({ error: { code: error.code, message: error.message } }, error.status);
}
