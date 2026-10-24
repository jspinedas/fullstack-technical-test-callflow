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

export interface CallSummary {
  id: string;
  callId: string;
  phoneNumber: string;
  agent: string;
  duration: number;
  recordingUrl: string | null;
  isSpam: boolean;
  isRecurrent: boolean;
  createdAt: string;
}

export interface CallsPage {
  items: CallSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MarkSpamResponse {
  id: string;
  isSpam: true;
  changed: boolean;
}

export interface CallEvent {
  type: 'call.created' | 'call.updated';
  id: string;
  callId: string;
}

export interface StreamStatus {
  connected: boolean;
}
