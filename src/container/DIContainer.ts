import { createClient, RedisClientType } from 'redis';
import mongoose from 'mongoose';
import { Configuration } from '../services/Configuration';
import { Logger } from '../services/Logger';
import { JobRepository } from '../repositories/JobRepository';
import { VendorClient } from '../services/VendorClient';
import { DataCleaner } from '../utils/DataCleaner';
import { JobQueue } from '../services/JobQueue';
import { 
  IConfiguration, 
  ILogger, 
  IJobRepository, 
  IVendorClient, 
  IDataCleaner,
  IJobQueue 
} from '../interfaces/services';

// Dependency Injection Container following Dependency Inversion Principle
export class DIContainer {
  private services: Map<string, any> = new Map();
  private singletons: Map<string, any> = new Map();

  // Register a service
  register<T>(name: string, factory: () => T, singleton: boolean = true): void {
    this.services.set(name, { factory, singleton });
  }

  // Get a service instance
  get<T>(name: string): T {
    const serviceConfig = this.services.get(name);
    if (!serviceConfig) {
      throw new Error(`Service ${name} not registered`);
    }

    if (serviceConfig.singleton) {
      if (!this.singletons.has(name)) {
        this.singletons.set(name, serviceConfig.factory());
      }
      return this.singletons.get(name);
    }

    return serviceConfig.factory();
  }

  // Check if service is registered
  has(name: string): boolean {
    return this.services.has(name);
  }
}

export class ApplicationContainer {
  private container: DIContainer;
  private redisClient: RedisClientType | null = null;
  private mongooseConnection: typeof mongoose | null = null;

  constructor() {
    this.container = new DIContainer();
  }

  async initialize(): Promise<void> {
      // Register basic services first
      this.registerBasicServices();
      
      // Initialize external connections
      await this.initializeConnections();
      
      // Register services that depend on connections
      this.registerDataServices();
      
      // Register business logic services
      this.registerBusinessServices();
      
      // Initialize job queue connection
      const jobQueue = this.getJobQueue();
      await jobQueue.connect();
    }


  private registerBasicServices(): void {
    // Configuration
    this.container.register<IConfiguration>('config', () => new Configuration());
    
    // Logger
    this.container.register<ILogger>('logger', () => 
      Logger.create('application')
    );
  }

  private async initializeConnections(): Promise<void> {
      const config = this.container.get<IConfiguration>('config') as Configuration;
      const logger = this.container.get<ILogger>('logger');
  
      try {
        // Mongoose connection with optimized settings for high load
        const mongoUrl = config.getMongoUrl();
        
        await mongoose.connect(mongoUrl, {
          maxPoolSize: 50,                    // Increased from default 10 for high concurrency
          minPoolSize: 10,                    // Maintain minimum connections ready
          maxIdleTimeMS: 30000,               // Connection idle timeout
          serverSelectionTimeoutMS: 5000,     // Faster server selection
          socketTimeoutMS: 45000,             // Socket timeout
          connectTimeoutMS: 10000,            // Connection establishment timeout
          heartbeatFrequencyMS: 10000,        // Health check frequency
          retryWrites: true,                  // Enable retryable writes
          retryReads: true                    // Enable retryable reads
        });
        
        this.mongooseConnection = mongoose;
        
        logger.info('Connected to MongoDB via Mongoose with optimized settings', {
          maxPoolSize: 50,
          minPoolSize: 10,
          database: mongoose.connection.db?.databaseName,
          host: mongoose.connection.host,
          port: mongoose.connection.port
        });

        // Set up Mongoose connection event listeners
        mongoose.connection.on('error', (error) => {
          logger.error('Mongoose connection error:', error);
        });

        mongoose.connection.on('disconnected', () => {
          logger.warn('Mongoose disconnected');
        });

        mongoose.connection.on('reconnected', () => {
          logger.info('Mongoose reconnected');
        });
  
        // Redis connection with enhanced reliability settings
        this.redisClient = createClient({ 
          url: config.getRedisUrl(),
          socket: {
            connectTimeout: 10000,            // Connection timeout
            reconnectStrategy: (retries) => {
              // Exponential backoff with max 3 second delay
              return Math.min(retries * 100, 3000);
            }
          },
          commandsQueueMaxLength: 1000,       // Max queued commands
        });
        await this.redisClient.connect();
        logger.info('Connected to Redis with enhanced reliability settings');
  
      } catch (error) {
        logger.error('Failed to initialize connections:', error);
        throw error;
      }
    }


  private registerDataServices(): void {
    // Job Repository - No longer needs MongoClient, uses Mongoose globally
    this.container.register<IJobRepository>('jobRepository', () => 
      new JobRepository(
        this.container.get<ILogger>('logger'),
        this.container.get<IConfiguration>('config')
      )
    );
  }

  private registerBusinessServices(): void {
      // Data Cleaner
      this.container.register<IDataCleaner>('dataCleaner', () => 
        new DataCleaner(this.container.get<ILogger>('logger'))
      );
      
      // Vendor Client
      this.container.register<IVendorClient>('vendorClient', () => 
        new VendorClient(
          this.container.get<ILogger>('logger'),
          this.container.get<IConfiguration>('config') as Configuration
        )
      );
  
      // Job Queue
      this.container.register<IJobQueue>('jobQueue', () => {
        const config = this.container.get<IConfiguration>('config');
        const logger = this.container.get<ILogger>('logger');
        return new JobQueue(logger, config as Configuration);
      });
    }


  // Get container for dependency injection
  getContainer(): DIContainer {
    return this.container;
  }

  // Get specific services (convenience methods)
  getConfiguration(): Configuration {
    return this.container.get<IConfiguration>('config') as Configuration;
  }

  getLogger(): ILogger {
    return this.container.get<ILogger>('logger');
  }

  getJobRepository(): IJobRepository {
    return this.container.get<IJobRepository>('jobRepository');
  }

  getVendorClient(): IVendorClient {
    return this.container.get<IVendorClient>('vendorClient');
  }

  getDataCleaner(): IDataCleaner {
    return this.container.get<IDataCleaner>('dataCleaner');
  }
  
    getJobQueue(): IJobQueue {
      return this.container.get<IJobQueue>('jobQueue');
    }

  // Get Mongoose instance for advanced operations
  getMongoose(): typeof mongoose {
    if (!this.mongooseConnection) {
      throw new Error('Mongoose not initialized');
    }
    return this.mongooseConnection;
  }
  
    getRedisClient(): RedisClientType {
      if (!this.redisClient) {
        throw new Error('Redis client not initialized');
      }
      return this.redisClient;
    }
  // Graceful shutdown
  async shutdown(): Promise<void> {
      const logger = this.container.get<ILogger>('logger');
      
      try {
        // Shutdown job queue
        const jobQueue = this.getJobQueue();
        await jobQueue.disconnect();
        
        // Close Mongoose connection
        if (this.mongooseConnection) {
          await mongoose.disconnect();
          logger.info('Mongoose connection closed');
        }
        
        if (this.redisClient) {
          await this.redisClient.quit();
          logger.info('Redis connection closed');
        }
        
        logger.info('Application shutdown completed');
      } catch (error) {
        logger.error('Error during shutdown:', error);
      }
    }
}
