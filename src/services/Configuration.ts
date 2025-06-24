import { IConfiguration } from "../interfaces/services";
import dotenv from "dotenv";

// Configuration service - keeps all env vars in one place
// I always do this because scattered process.env calls are a nightmare to maintain
export class Configuration implements IConfiguration {
  constructor() {
    dotenv.config();  // Load .env file
  }

  get(key: string): string | undefined {
    return process.env[key];
  }

  // Type-safe number parsing with sensible defaults
  getNumber(key: string, defaultValue: number = 0): number {
    const value = this.get(key);
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;  // Don't crash on bad input
  }

  // Boolean parsing that handles common variations
  getBoolean(key: string, defaultValue: boolean = false): boolean {
    const value = this.get(key);
    if (!value) return defaultValue;
    return value.toLowerCase() === "true";  // Only "true" is true, everything else is false
  }

  // Specific getters with reasonable defaults for local development
  getMongoUrl(): string {
    return this.get("MONGO_URL") || "mongodb://localhost:27017";  // Standard MongoDB port
  }

  getRedisUrl(): string {
    return this.get("REDIS_URL") || "redis://localhost:6379";     // Standard Redis port
  }

  getPort(): number {
    return this.getNumber("PORT", 3000);  // 3000 is the classic Node.js dev port
  }

  getNodeEnv(): string {
    return this.get("NODE_ENV") || "development";  // Assume dev unless told otherwise
  }

  getApiBaseUrl(): string {
    return this.get("API_BASE_URL") || "http://localhost:3000";  // Self-reference for webhooks
  }

  getSyncVendorUrl(): string {
    return this.get("SYNC_VENDOR_URL") || "http://localhost:3001/api/data";  // Mock sync vendor
  }

  getAsyncVendorUrl(): string {
    return this.get("ASYNC_VENDOR_URL") || "http://localhost:3002/api/data";
  }
}
