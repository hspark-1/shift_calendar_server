export interface PushMessage {
  provider_target: string;
  notification_id: string;
  title: string;
  body: string | null;
  data: Record<string, string>;
  ttl_seconds: number;
}

export interface PushSendResult {
  success: boolean;
  provider_message_id?: string;
  error_code?: string;
  retry_after_seconds?: number;
}

export interface PushProvider {
  sendBatch(messages: PushMessage[]): Promise<PushSendResult[]>;
  checkReady(): Promise<void>;
}
