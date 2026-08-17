interface ErrorLike {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  status_code?: unknown;
  environment_variable?: unknown;
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
  const environment_variable =
    typeof error_like?.environment_variable === "string"
      ? error_like.environment_variable
      : undefined;

  console.error(
    JSON.stringify({
      level: "error",
      context,
      request_id: request_id ?? null,
      error_name,
      error_code: error_code ?? null,
      environment_variable: environment_variable ?? null,
      http_status: http_status ?? null,
    })
  );
}

export interface AppleAuthLogEvent {
  request_id?: string;
  platform?: "ios" | "android";
  user_id?: string;
  action: "challenge" | "callback" | "login";
  result: "success" | "denied" | "error";
  error_code?: string;
  duration_ms: number;
}

export function logAppleAuthEvent(event: AppleAuthLogEvent): void {
  const output = {
    level: event.result === "error" ? "error" : "info",
    context: "apple_auth",
    request_id: event.request_id ?? null,
    provider: "APPLE",
    platform: event.platform ?? null,
    user_id: event.user_id ?? null,
    action: event.action,
    result: event.result,
    error_code: event.error_code ?? null,
    duration_ms: event.duration_ms,
  };

  if (event.result === "error") {
    console.error(JSON.stringify(output));
    return;
  }
  console.log(JSON.stringify(output));
}

export interface GoogleAuthLogEvent {
  request_id?: string;
  user_id?: string;
  result: "success" | "denied" | "error";
  error_code?: string;
  duration_ms: number;
  is_new_user?: boolean;
}

export function logGoogleAuthEvent(event: GoogleAuthLogEvent): void {
  const output = {
    level: event.result === "error" ? "error" : "info",
    context: "google_auth",
    request_id: event.request_id ?? null,
    provider: "GOOGLE",
    user_id: event.user_id ?? null,
    action: "google_login",
    result: event.result,
    error_code: event.error_code ?? null,
    duration_ms: event.duration_ms,
    is_new_user: event.is_new_user ?? null,
  };

  if (event.result === "error") {
    console.error(JSON.stringify(output));
    return;
  }
  console.log(JSON.stringify(output));
}

export interface KakaoAuthLogEvent {
  request_id?: string;
  user_id?: string;
  action: "token_login" | "legacy_route_access";
  result: "success" | "denied" | "error";
  error_code?: string;
  duration_ms: number;
  is_new_user?: boolean;
}

export function logKakaoAuthEvent(event: KakaoAuthLogEvent): void {
  const output = {
    level: event.result === "error" ? "error" : "info",
    context: "kakao_auth",
    request_id: event.request_id ?? null,
    provider: "KAKAO",
    user_id: event.user_id ?? null,
    action: event.action,
    result: event.result,
    error_code: event.error_code ?? null,
    duration_ms: event.duration_ms,
    is_new_user: event.is_new_user ?? null,
  };

  if (event.result === "error") {
    console.error(JSON.stringify(output));
    return;
  }
  console.log(JSON.stringify(output));
}

export interface GroupLogEvent {
  request_id?: string;
  actor_user_id: string;
  group_id?: string;
  action: string;
  result: "success" | "denied" | "error";
  duration_ms: number;
  range_days?: number;
  member_count?: number;
  row_count?: number;
  response_bytes?: number;
}

export function logGroupEvent(event: GroupLogEvent): void {
  const output = {
    level: event.result === "error" ? "error" : "info",
    context: "group_api",
    request_id: event.request_id ?? null,
    actor_user_id: event.actor_user_id,
    group_id: event.group_id ?? null,
    action: event.action,
    result: event.result,
    duration_ms: event.duration_ms,
    range_days: event.range_days ?? null,
    member_count: event.member_count ?? null,
    row_count: event.row_count ?? null,
    response_bytes: event.response_bytes ?? null,
  };

  if (event.result === "error") {
    console.error(JSON.stringify(output));
    return;
  }
  console.log(JSON.stringify(output));
}
