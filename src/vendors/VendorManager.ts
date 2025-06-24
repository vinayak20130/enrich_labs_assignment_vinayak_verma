import axios from "axios";
import winston from "winston";
import { Configuration } from "../services/Configuration";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

interface VendorConfig {
  name: string;
  url: string;
  rateLimit: number;   // requests per minute - learned to always enforce this
  isAsync: boolean;    // sync = immediate response, async = webhook callback
  timeout: number;     // how long to wait before giving up
}

interface VendorResponse {
  data: any;
  isAsync: boolean;
  status: "success" | "error";
  error?: string;
}

// This is where vendor-specific logic lives - keeps the rest of the code clean
export class VendorManager {
  private vendors: Map<string, VendorConfig>;
  private rateLimiters: Map<string, RateLimiter>;  // One rate limiter per vendor
  private config: Configuration;

  constructor(config: Configuration) {
    this.config = config;
    this.vendors = new Map();
    this.rateLimiters = new Map();
    this.initializeVendors();  // Set up all known vendors
  }

  private initializeVendors() {
    // Sync vendor setup - returns data immediately but has tighter rate limits
    const syncVendor: VendorConfig = {
      name: "syncVendor",
      url: this.config.getSyncVendorUrl() || "http://localhost:3001/api/data",
      rateLimit: 60,     // Higher limit since responses are immediate
      isAsync: false,    // We get the response right away
      timeout: 5000,     // 5 seconds max - sync should be fast
    };

    // Async vendor setup - calls back later via webhook
    const asyncVendor: VendorConfig = {
      name: "asyncVendor",
      url: this.config.getAsyncVendorUrl() || "http://localhost:3002/api/data",
      rateLimit: 30, // 30 requests per minute
      isAsync: true,
      timeout: 15000, // Increased timeout for async processing
    };

    this.vendors.set("syncVendor", syncVendor);
    this.vendors.set("asyncVendor", asyncVendor);

    // Initialize rate limiters
    this.rateLimiters.set("syncVendor", new RateLimiter(syncVendor.rateLimit));
    this.rateLimiters.set(
      "asyncVendor",
      new RateLimiter(asyncVendor.rateLimit)
    );

    logger.info("Vendors initialized", {
      vendors: Array.from(this.vendors.keys()),
    });
  }

  async callVendor(
    vendorName: string,
    payload: any,
    requestId: string
  ): Promise<VendorResponse> {
    const vendor = this.vendors.get(vendorName);
    if (!vendor) {
      throw new Error(`Unknown vendor: ${vendorName}`);
    }

    const rateLimiter = this.rateLimiters.get(vendorName);
    if (!rateLimiter) {
      throw new Error(`Rate limiter not found for vendor: ${vendorName}`);
    }

    // Wait for rate limit
    await rateLimiter.waitForSlot();

    try {
      logger.info(`Calling ${vendorName} for request ${requestId}`);

      const requestData = {
        ...payload,
        requestId,
        timestamp: new Date().toISOString(),
      };

      // For async vendors, include webhook URL
      if (vendor.isAsync) {
        requestData.webhookUrl = `${this.config.getApiBaseUrl()}/vendor-webhook/${vendorName}`;
      }

      const response = await axios.post(vendor.url, requestData, {
        timeout: vendor.timeout,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": requestId,
        },
      });

      logger.info(`${vendorName} responded for request ${requestId}`, {
        status: response.status,
        isAsync: vendor.isAsync,
      });

      return {
        data: response.data,
        isAsync: vendor.isAsync,
        status: "success",
      };
    } catch (error) {
      logger.error(
        `Error calling ${vendorName} for request ${requestId}:`,
        error
      );

      let errorMessage = "Unknown vendor error";
      if (axios.isAxiosError(error)) {
        errorMessage =
          error.response?.data?.message ||
          error.message ||
          "HTTP request failed";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        data: null,
        isAsync: vendor.isAsync,
        status: "error",
        error: errorMessage,
      };
    }
  }

  getVendorInfo(vendorName: string): VendorConfig | undefined {
    return this.vendors.get(vendorName);
  }

  getAllVendors(): VendorConfig[] {
    return Array.from(this.vendors.values());
  }
}

// Rate Limiter implementation
class RateLimiter {
  private tokens: number;
  private capacity: number;
  private refillRate: number;
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
    const waitTime = ((1 - this.tokens) / this.refillRate) * 1000; // milliseconds
    logger.info(`Rate limit reached, waiting ${waitTime}ms`);

    await new Promise((resolve) => setTimeout(resolve, waitTime));
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
