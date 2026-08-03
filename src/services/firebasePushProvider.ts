import {
  App,
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getMessaging, Message } from "firebase-admin/messaging";
import { getRequiredEnvironmentVariable } from "../config/environment";
import {
  PushMessage,
  PushProvider,
  PushSendResult,
} from "./pushProvider";

interface FirebaseErrorLike {
  code?: unknown;
  errorInfo?: { code?: unknown };
  retry_after_seconds?: unknown;
  retryAfter?: unknown;
}

function getFirebaseErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "UNKNOWN_ERROR";
  const error_like = error as FirebaseErrorLike;
  const code = error_like.code ?? error_like.errorInfo?.code;
  return typeof code === "string" ? code : "UNKNOWN_ERROR";
}

function getRetryAfterSeconds(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const error_like = error as FirebaseErrorLike;
  const candidate = error_like.retry_after_seconds ?? error_like.retryAfter;
  const parsed_value = Number(candidate);
  return Number.isFinite(parsed_value) && parsed_value > 0
    ? Math.ceil(parsed_value)
    : undefined;
}

function toFirebaseMessage(message: PushMessage): Message {
  const expiration_seconds = Math.floor(Date.now() / 1000) + message.ttl_seconds;
  return {
    token: message.provider_target,
    notification: {
      title: message.title,
      ...(message.body ? { body: message.body } : {}),
    },
    data: message.data,
    android: {
      priority: "high",
      ttl: message.ttl_seconds * 1000,
      collapseKey: message.notification_id,
      notification: {
        channelId: "shiftmate_high",
        tag: message.notification_id,
        sound: "default",
      },
    },
    apns: {
      headers: {
        "apns-collapse-id": message.notification_id,
        "apns-expiration": String(expiration_seconds),
        "apns-priority": "10",
      },
      payload: { aps: { sound: "default" } },
    },
  };
}

export function createFirebasePushProvider(): PushProvider {
  const project_id = getRequiredEnvironmentVariable("FIREBASE_PROJECT_ID");
  const app_name = `shiftmate-push-${project_id}`;
  const credential = applicationDefault();
  const existing_app = getApps().find((app) => app.name === app_name);
  const firebase_app: App =
    existing_app ??
    initializeApp({ credential, projectId: project_id }, app_name);
  const messaging = getMessaging(firebase_app);

  return {
    async sendBatch(messages: PushMessage[]): Promise<PushSendResult[]> {
      if (messages.length === 0) return [];
      try {
        const response = await messaging.sendEach(messages.map(toFirebaseMessage));
        return response.responses.map((send_response) => {
          if (send_response.success) {
            return {
              success: true,
              provider_message_id: send_response.messageId,
            };
          }
          return {
            success: false,
            error_code: getFirebaseErrorCode(send_response.error),
            retry_after_seconds: getRetryAfterSeconds(send_response.error),
          };
        });
      } catch (error) {
        const failed_result = {
          success: false,
          error_code: getFirebaseErrorCode(error),
          retry_after_seconds: getRetryAfterSeconds(error),
        };
        return messages.map(() => failed_result);
      }
    },

    async checkReady(): Promise<void> {
      const access_token = await credential.getAccessToken();
      if (!access_token.access_token) {
        throw new Error("FIREBASE_CREDENTIAL_NOT_READY");
      }
    },
  };
}
