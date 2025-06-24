import { ILogger } from '../interfaces/services';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing fast
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold: number;      // Number of failures before opening
  recoveryTimeout: number;       // Time before attempting recovery (ms)
  monitoringWindow: number;      // Time window for failure tracking (ms)
  expectedLatency: number;       // Expected response time (ms)
  latencyThreshold: number;      // Latency threshold for considering slow (ms)
  minimumRequests: number;       // Minimum requests before evaluating
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  totalRequests: number;
  lastFailureTime: number | null;
  lastStateChange: number;
  avgLatency: number;
  errorRate: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private totalRequests: number = 0;
  private lastFailureTime: number | null = null;
  private lastStateChange: number = Date.now();
  private latencies: number[] = [];
  private requestTimes: number[] = [];

  constructor(
    private serviceName: string,
    private options: CircuitBreakerOptions,
    private logger: ILogger
  ) {
    this.logger.info(`Circuit breaker initialized for ${serviceName}`, {
      failureThreshold: options.failureThreshold,
      recoveryTimeout: options.recoveryTimeout,
      monitoringWindow: options.monitoringWindow
    });
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.setState(CircuitBreakerState.HALF_OPEN);
      } else {
        throw new Error(`Circuit breaker is OPEN for ${this.serviceName}. Service unavailable.`);
      }
    }

    const startTime = Date.now();
    this.totalRequests++;
    this.requestTimes.push(startTime);
    this.cleanupOldRequests();

    try {
      const result = await Promise.race([
        operation(),
        this.createTimeoutPromise<T>()
      ]) as T;

      const latency = Date.now() - startTime;
      this.onSuccess(latency);
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.onFailure(error, latency);
      throw error;
    }
  }

  private createTimeoutPromise<T>(): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timeout after ${this.options.latencyThreshold}ms`));
      }, this.options.latencyThreshold);
    });
  }

  private onSuccess(latency: number): void {
    this.successes++;
    this.latencies.push(latency);
    this.keepRecentLatencies();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.setState(CircuitBreakerState.CLOSED);
      this.resetCounters();
      this.logger.info(`Circuit breaker CLOSED for ${this.serviceName} - service recovered`);
    }

    // Check if we're experiencing high latency
    if (latency > this.options.latencyThreshold) {
      this.logger.warn(`High latency detected for ${this.serviceName}`, {
        latency,
        threshold: this.options.latencyThreshold
      });
    }
  }

  private onFailure(error: any, latency: number): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.latencies.push(latency);
    this.keepRecentLatencies();

    this.logger.warn(`Circuit breaker failure for ${this.serviceName}`, {
      error: error.message,
      failures: this.failures,
      state: this.state,
      latency
    });

    if (this.shouldOpen()) {
      this.setState(CircuitBreakerState.OPEN);
      this.logger.error(`Circuit breaker OPENED for ${this.serviceName}`, {
        failures: this.failures,
        errorRate: this.getErrorRate(),
        avgLatency: this.getAverageLatency()
      });
    }
  }

  private shouldOpen(): boolean {
    // Don't open if we haven't met minimum request threshold
    if (this.totalRequests < this.options.minimumRequests) {
      return false;
    }

    // Open if we've exceeded failure threshold
    if (this.failures >= this.options.failureThreshold) {
      return true;
    }

    // Open if error rate is too high (> 50%) and we have enough requests
    const errorRate = this.getErrorRate();
    if (errorRate > 0.5 && this.getRecentRequestCount() >= this.options.minimumRequests) {
      return true;
    }

    // Open if average latency is too high
    const avgLatency = this.getAverageLatency();
    if (avgLatency > this.options.latencyThreshold * 2) {
      return true;
    }

    return false;
  }

  private shouldAttemptReset(): boolean {
    if (this.lastFailureTime === null) return true;
    return Date.now() - this.lastFailureTime >= this.options.recoveryTimeout;
  }

  private setState(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (oldState !== newState) {
      this.logger.info(`Circuit breaker state changed for ${this.serviceName}`, {
        from: oldState,
        to: newState,
        stats: this.getStats()
      });
    }
  }

  private resetCounters(): void {
    this.failures = 0;
    this.successes = 0;
    this.latencies = [];
  }

  private cleanupOldRequests(): void {
    const cutoff = Date.now() - this.options.monitoringWindow;
    this.requestTimes = this.requestTimes.filter(time => time > cutoff);
  }

  private keepRecentLatencies(): void {
    // Keep only last 100 latencies to prevent memory leak
    if (this.latencies.length > 100) {
      this.latencies = this.latencies.slice(-50);
    }
  }

  private getRecentRequestCount(): number {
    const cutoff = Date.now() - this.options.monitoringWindow;
    return this.requestTimes.filter(time => time > cutoff).length;
  }

  private getErrorRate(): number {
    const total = this.failures + this.successes;
    return total > 0 ? this.failures / total : 0;
  }

  private getAverageLatency(): number {
    if (this.latencies.length === 0) return 0;
    const sum = this.latencies.reduce((acc, latency) => acc + latency, 0);
    return sum / this.latencies.length;
  }

  public getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      avgLatency: this.getAverageLatency(),
      errorRate: this.getErrorRate()
    };
  }

  public getState(): CircuitBreakerState {
    return this.state;
  }

  public isOpen(): boolean {
    return this.state === CircuitBreakerState.OPEN;
  }

  public isClosed(): boolean {
    return this.state === CircuitBreakerState.CLOSED;
  }

  public isHalfOpen(): boolean {
    return this.state === CircuitBreakerState.HALF_OPEN;
  }

  // Manual controls (for testing/admin)
  public forceOpen(): void {
    this.setState(CircuitBreakerState.OPEN);
    this.logger.warn(`Circuit breaker manually OPENED for ${this.serviceName}`);
  }

  public forceClose(): void {
    this.setState(CircuitBreakerState.CLOSED);
    this.resetCounters();
    this.logger.info(`Circuit breaker manually CLOSED for ${this.serviceName}`);
  }

  public reset(): void {
    this.setState(CircuitBreakerState.CLOSED);
    this.resetCounters();
    this.totalRequests = 0;
    this.requestTimes = [];
    this.lastFailureTime = null;
    this.logger.info(`Circuit breaker RESET for ${this.serviceName}`);
  }
}

// Circuit Breaker Manager for multiple services
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();

  constructor(private logger: ILogger) {}

  public createBreaker(serviceName: string, options: CircuitBreakerOptions): CircuitBreaker {
    const breaker = new CircuitBreaker(serviceName, options, this.logger);
    this.breakers.set(serviceName, breaker);
    return breaker;
  }

  public getBreaker(serviceName: string): CircuitBreaker | undefined {
    return this.breakers.get(serviceName);
  }

  public getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  public getHealthyServices(): string[] {
    const healthy: string[] = [];
    for (const [name, breaker] of this.breakers) {
      if (breaker.isClosed()) {
        healthy.push(name);
      }
    }
    return healthy;
  }

  public getUnhealthyServices(): string[] {
    const unhealthy: string[] = [];
    for (const [name, breaker] of this.breakers) {
      if (breaker.isOpen()) {
        unhealthy.push(name);
      }
    }
    return unhealthy;
  }

  public resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    this.logger.info('All circuit breakers reset');
  }
}

// Default circuit breaker configurations
export const CIRCUIT_BREAKER_CONFIGS = {
  VENDOR_API: {
    failureThreshold: 5,      // 5 failures
    recoveryTimeout: 30000,   // 30 seconds
    monitoringWindow: 60000,  // 1 minute
    expectedLatency: 1000,    // 1 second
    latencyThreshold: 5000,   // 5 seconds
    minimumRequests: 3        // At least 3 requests
  },
  DATABASE: {
    failureThreshold: 3,      // 3 failures
    recoveryTimeout: 10000,   // 10 seconds
    monitoringWindow: 30000,  // 30 seconds
    expectedLatency: 100,     // 100ms
    latencyThreshold: 1000,   // 1 second
    minimumRequests: 5        // At least 5 requests
  },
  REDIS: {
    failureThreshold: 3,      // 3 failures
    recoveryTimeout: 5000,    // 5 seconds
    monitoringWindow: 30000,  // 30 seconds
    expectedLatency: 10,      // 10ms
    latencyThreshold: 100,    // 100ms
    minimumRequests: 3        // At least 3 requests
  }
};
