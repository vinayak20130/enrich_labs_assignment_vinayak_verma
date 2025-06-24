// Core domain interfaces and types
export interface Job {
  requestId: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  payload: any;
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  vendor?: string;
}

export interface VendorResponse {
  data: any;
  isAsync: boolean;
  status: 'success' | 'error';
  error?: string;
}

export interface VendorConfig {
  name: string;
  url: string;
  rateLimit: number; 
  isAsync: boolean;
  timeout: number;
}

export interface CleaningRule {
  field: string;
  action: 'remove' | 'mask' | 'trim' | 'normalize';
  pattern?: RegExp;
  replacement?: string;
}

export interface QueueMessage {
  id: string;
  message: {
    requestId: string;
    payload: string;
    timestamp: string;
  };
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  burstAllowed?: number;
}
