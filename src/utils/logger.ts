interface ErrorLike {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  status_code?: unknown;
  response?: {
    status?: unknown;
  };
}

export function logError(
  context: string,
  error: unknown,
  request_id?: string
): void {
  const error_like =
    typeof error === "object" && error !== null
      ? (error as ErrorLike)
      : undefined;
  const error_name =
    error instanceof Error
      ? error.name
      : typeof error_like?.name === "string"
        ? error_like.name
        : "UnknownError";
  const error_code =
    typeof error_like?.code === "string" ? error_like.code : undefined;
  const http_status_candidates = [
    error_like?.status_code,
    error_like?.status,
    error_like?.response?.status,
  ];
  const http_status = http_status_candidates.find(
    (candidate): candidate is number => typeof candidate === "number"
  );

  console.error(
    JSON.stringify({
      level: "error",
      context,
      request_id: request_id ?? null,
      error_name,
      error_code: error_code ?? null,
      http_status: http_status ?? null,
    })
  );
}
