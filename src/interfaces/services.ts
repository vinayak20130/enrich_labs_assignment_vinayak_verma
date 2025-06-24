import { Job, VendorResponse, VendorConfig, QueueMessage } from '../types/domain';

// Database operations interface
export interface IJobRepository {
  create(job: Job): Promise<void>;
  findById(requestId: string): Promise<Job | null>;
  updateStatus(requestId: string, status: Job['status']): Promise<void>;
  updateResult(requestId: string, status: Job['status'], result?: any, error?: string): Promise<void>;
  healthCheck(): Promise<boolean>;
  
  // Additional Mongoose-powered methods
  findByStatus(status: Job['status'], limit?: number): Promise<Job[]>;
  findByVendor(vendor: string, limit?: number): Promise<Job[]>;
  getRecentJobs(hours?: number): Promise<Job[]>;
  getJobStats(): Promise<{ 
    total: number; 
    byStatus: Record<string, number>; 
    byVendor: Record<string, number> 
  }>;
}


// Queue operations interface
export interface IJobQueue {
  connect(): Promise<void>;
  addJob(requestId: string, payload: any): Promise<void>;
  consumeJobs(consumerGroup: string, consumerId: string): Promise<QueueMessage[]>;
  acknowledgeJob(messageId: string): Promise<void>;
  disconnect(): Promise<void>;
}


// Vendor communication interface
export interface IVendorClient {
  callVendor(vendorName: string, payload: any, requestId: string): Promise<VendorResponse>;
  getVendorConfig(vendorName: string): VendorConfig | undefined;
  getAllVendors(): VendorConfig[];
  healthCheckAll(): Promise<Map<string, boolean>>;
}

// Data cleaning interface
export interface IDataCleaner {
  clean(data: any): any;
  addCustomRule(rule: any): void;
}

// Rate limiting interface
export interface IRateLimiter {
  waitForSlot(): Promise<void>;
  getTokenCount(): number;
}

// Vendor selection strategy interface
export interface IVendorSelector {
  selectVendor(payload: any): Promise<string>;
}

// Logging interface
export interface ILogger {
  info(message: string, meta?: any): void;
  error(message: string, error?: any): void;
  warn(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

// Configuration interface
export interface IConfiguration {
  get(key: string): string | undefined;
  getNumber(key: string, defaultValue?: number): number;
  getBoolean(key: string, defaultValue?: boolean): boolean;
}