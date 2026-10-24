export interface HealthResponse {
  status: 'ok';
  service: 'callflow-api';
}

export interface CallWebhookPayload {
  callId: string;
  phoneNumber: string;
  agent: string;
  duration: number;
  recordingUrl?: string;
}

export interface CallWebhookResponse {
  callId: string;
  inserted: boolean;
  isRecurrent: boolean;
}
