import {
  getBooleanEnvironmentVariable,
  getPositiveIntegerEnvironmentVariable,
} from "./environment";
import type { PushAppEnvironment } from "../models/UserDevice";

export function getPushAppEnvironment(): PushAppEnvironment {
  const configured_environment = process.env.PUSH_APP_ENVIRONMENT?.trim();
  if (configured_environment === "STAGE" || configured_environment === "PROD") {
    return configured_environment;
  }
  if (configured_environment) {
    throw new Error("PUSH_APP_ENVIRONMENT는 STAGE 또는 PROD여야 합니다.");
  }
  return process.env.NODE_ENV === "production" ? "PROD" : "STAGE";
}

export function isPushJobEnqueueEnabled(): boolean {
  return getBooleanEnvironmentVariable("PUSH_JOB_ENQUEUE_ENABLED", false);
}

export function isPushWorkerEnabled(): boolean {
  return getBooleanEnvironmentVariable("PUSH_WORKER_ENABLED", false);
}

export function getPushJobTtlSeconds(): number {
  return getPositiveIntegerEnvironmentVariable("PUSH_JOB_TTL_SECONDS", 3600);
}
