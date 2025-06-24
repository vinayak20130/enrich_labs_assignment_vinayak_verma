import { IVendorClient, IRateLimiter, ILogger, IConfiguration } from '../interfaces/services';
import { VendorResponse, VendorConfig } from '../types/domain';
import axios from 'axios';
import { Configuration } from './Configuration';

// Rate Limiter implementation
export class TokenBucketRateLimiter implements IRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private lastRefill: number;

  constructor(requestsPerMinute: number) {
    this.capacity = requestsPerMinute;
    this.tokens = requestsPerMinute;
    this.refillRate = requestsPerMinute / 60; // tokens per second
    this.lastRefill = Date.now();
  }

  async waitForSlot(): Promise<void> {
    await this.refillTokens();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait until we can get a token
    const waitTime = (1 - this.tokens) / this.refillRate * 1000; // milliseconds
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return this.waitForSlot();
  }

  private async refillTokens(): Promise<void> {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getTokenCount(): number {
    return this.tokens;
  }
}

// Vendor Client following Open/Closed and Strategy Principles
export class VendorClient implements IVendorClient {
  private vendors: Map<string, VendorConfig>;
  private rateLimiters: Map<string, IRateLimiter>;

  constructor(
    private logger: ILogger,
    private config: Configuration
  ) {
    this.vendors = new Map();
    this.rateLimiters = new Map();
    this.initializeVendors();
  }

  private initializeVendors(): void {
    const syncVendor: VendorConfig = {
      name: 'syncVendor',
      url: this.config.getSyncVendorUrl() || 'http://localhost:3001/api/data',
      rateLimit: this.config.getNumber('SYNC_VENDOR_RATE_LIMIT', 60),
      isAsync: false,
      timeout: this.config.getNumber('SYNC_VENDOR_TIMEOUT', 5000)
    };

    const asyncVendor: VendorConfig = {
      name: 'asyncVendor',
      url: this.config.getAsyncVendorUrl() || 'http://localhost:3002/api/data',
      rateLimit: this.config.getNumber('ASYNC_VENDOR_RATE_LIMIT', 30),
      isAsync: true,
      timeout: this.config.getNumber('ASYNC_VENDOR_TIMEOUT', 10000)
    };

    this.registerVendor(syncVendor);
    this.registerVendor(asyncVendor);

    this.logger.info('Vendors initialized', { 
      vendors: Array.from(this.vendors.keys()) 
    });
  }

  // Open/Closed: Open for extension via this method
  registerVendor(vendor: VendorConfig): void {
    this.vendors.set(vendor.name, vendor);
    this.rateLimiters.set(vendor.name, new TokenBucketRateLimiter(vendor.rateLimit));
    this.logger.info(`Vendor registered: ${vendor.name}`);
  }

  async callVendor(vendorName: string, payload: any, requestId: string): Promise<VendorResponse> {
    const vendor = this.vendors.get(vendorName);
    if (!vendor) {
      throw new Error(`Unknown vendor: ${vendorName}`);
    }

    const rateLimiter = this.rateLimiters.get(vendorName);
    if (!rateLimiter) {
      throw new Error(`Rate limiter not found for vendor: ${vendorName}`);
    }

    // Apply rate limiting
    await rateLimiter.waitForSlot();

    try {
      this.logger.info(`Calling ${vendorName} for request ${requestId}`);

      const requestData = this.prepareRequestData(vendor, payload, requestId);
      const response = await this.makeHttpRequest(vendor, requestData, requestId);

      this.logger.info(`${vendorName} responded for request ${requestId}`, {
        status: response.status,
        isAsync: vendor.isAsync
      });

      return {
        data: response.data,
        isAsync: vendor.isAsync,
        status: 'success'
      };

    } catch (error) {
      this.logger.error(`Error calling ${vendorName} for request ${requestId}:`, error);
      
      let errorMessage = 'Unknown vendor error';
      if (axios.isAxiosError(error)) {
        errorMessage = error.response?.data?.message || error.message || 'HTTP request failed';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return {
        data: null,
        isAsync: vendor.isAsync,
        status: 'error',
        error: errorMessage
      };
    }
  }

  getVendorConfig(vendorName: string): VendorConfig | undefined {
    return this.vendors.get(vendorName);
  }

  getAllVendors(): VendorConfig[] {
    return Array.from(this.vendors.values());
  }

  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    for (const [name, vendor] of this.vendors) {
      try {
        const healthUrl = vendor.url.replace('/api/data', '/health');
        await axios.get(healthUrl, { timeout: 5000 });
        results.set(name, true);
      } catch (error) {
        this.logger.warn(`Vendor ${name} health check failed`, error);
        results.set(name, false);
      }
    }
    
    return results;
  }

  private prepareRequestData(vendor: VendorConfig, payload: any, requestId: string): any {
    const requestData = {
      ...payload,
      requestId,
      timestamp: new Date().toISOString()
    };

    // For async vendors, include webhook URL
    if (vendor.isAsync) {
      requestData.webhookUrl = `${this.config.getApiBaseUrl() || 'http://localhost:3000'}/vendor-webhook/${vendor.name}`;
    }

    return requestData;
  }

  private async makeHttpRequest(vendor: VendorConfig, requestData: any, requestId: string) {
    return axios.post(vendor.url, requestData, {
      timeout: vendor.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      }
    });
  }
}