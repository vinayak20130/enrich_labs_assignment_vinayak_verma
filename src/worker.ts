import { createClient, RedisClientType } from "redis";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { VendorManager } from "./vendors/VendorManager";
import { DataCleaner } from "./utils/DataCleaner";
import { JobModel } from "./models/Job";
import { Configuration } from "./services/Configuration";
import { Logger } from "./services/Logger";


dotenv.config();

// The background worker - this is where the real work happens
// Picks up jobs from Redis queue and processes them with vendors
class BackgroundWorker {
  private redisClient: RedisClientType | null = null;
  private vendorManager: VendorManager;
  private dataCleaner: DataCleaner;
  private logger: Logger;

  private isRunning = false; // Used for graceful shutdown

  constructor(private config: Configuration, logger: Logger) {
    this.vendorManager = new VendorManager(config);
    this.dataCleaner = new DataCleaner();
    this.logger = logger;
  }


  async initialize() {
    try {
      // MongoDB connection - worker needs reliable writes for job status updates
      const mongoUrl = this.config.getMongoUrl();

      await mongoose.connect(mongoUrl, {
        maxPoolSize: 30,            // Enough connections for concurrent job processing
        minPoolSize: 5,             // Keep some connections warm
        maxIdleTimeMS: 30000,       // Close idle connections to save resources
        serverSelectionTimeoutMS: 5000,  // Fail fast if MongoDB is down
        socketTimeoutMS: 45000,     // Longer timeout for large payload updates
        connectTimeoutMS: 10000,    // Quick connection establishment
        heartbeatFrequencyMS: 10000, // Check MongoDB health regularly
        retryWrites: true,          // Critical - retry failed job status updates
        retryReads: true,           // Retry reads for consistency
      });

      this.logger.info(
        "Worker connected to MongoDB via Mongoose with optimized settings",
        {
          maxPoolSize: 30,
          minPoolSize: 5,
          database: mongoose.connection.db?.databaseName,
        }
      );

      // Redis connection - this is our job queue, needs to be rock solid
      const redisUrl = this.config.getRedisUrl();
      this.redisClient = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 10000,       // Don't wait forever for Redis
          reconnectStrategy: (retries) => {
            // Exponential backoff but cap it - we need workers back online quickly
            return Math.min(retries * 50, 2000);
          },
        },
        commandsQueueMaxLength: 2000,  // Bigger queue for high-throughput scenarios
      });
      await this.redisClient.connect();
      this.logger.info(
        "Worker connected to Redis with enhanced reliability settings"
      );

      // Set up Redis consumer group - this lets us scale workers horizontally
      // and ensures jobs don't get lost if a worker crashes
      try {
        await this.redisClient.xGroupCreate("job-queue", "workers", "$", {
          MKSTREAM: true,  // Create the stream if it doesn't exist
        });
        this.logger.info("Created Redis consumer group for workers");
      } catch (error) {
        // Usually means the group already exists from a previous run
        this.logger.info("Consumer group already exists - that's fine");
      }
    } catch (error) {
      this.logger.error("Failed to initialize worker:", error);
      process.exit(1);
    }
  }

  async start() {
    if (!mongoose.connection.readyState || !this.redisClient) {
      throw new Error("Worker not initialized. Call initialize() first.");
    }

    this.isRunning = true;
    this.logger.info("Background worker started - let's process some jobs!");

    // Main event loop - keeps running until we get a shutdown signal
    while (this.isRunning) {
      try {
        // Check Redis for new jobs - blocks for 1 second if nothing available
        // Consumer groups ensure we don't double-process jobs
        const messages = await this.redisClient.xReadGroup(
          "workers",           // Consumer group name
          "worker-1",          // Consumer name (could be dynamic for multiple workers)
          { key: "job-queue", id: ">" },  // Stream name, only new messages
          { COUNT: 1, BLOCK: 1000 }       // One job at a time, 1 second timeout
        );

        if (messages && messages.length > 0) {
          for (const stream of messages) {
            for (const message of stream.messages) {
              await this.processJob(message);
              // Critical: acknowledge the message so it doesn't get redelivered
              await this.redisClient.xAck("job-queue", "workers", message.id);
            }
          }
        }
      } catch (error) {
        this.logger.error("Error in worker loop:", error);
        // Don't spam retries - give Redis/network a moment to recover
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async processJob(message: any) {
    const { requestId, payload } = message.message;

    try {
      this.logger.info(`Processing job ${requestId} - here we go!`);

      // Mark job as processing so status checks show current state
      await this.updateJobStatus(requestId, "processing");

      // Parse payload
      const jobPayload = JSON.parse(payload);

      // Determine which vendor to use (for demo, we'll alternate)
      const vendor = await this.selectVendor(jobPayload);

      // Update job with vendor info using Mongoose
      await JobModel.updateOne(
        { requestId },
        {
          $set: {
            vendor,
            updatedAt: new Date(),
          },
        }
      );

      this.logger.info(`Job ${requestId} assigned to vendor: ${vendor}`);

      // Call vendor API with rate limiting
      const vendorResponse = await this.vendorManager.callVendor(
        vendor,
        jobPayload,
        requestId
      );

      if (vendorResponse.isAsync) {
        // For async vendors, the webhook will handle completion
        this.logger.info(
          `Async job ${requestId} sent to ${vendor}, waiting for webhook`
        );
      } else {
        // For sync vendors, process the response immediately
        const cleanedData = this.dataCleaner.clean(vendorResponse.data);

        await this.updateJobResult(requestId, "complete", cleanedData);
        this.logger.info(
          `Job ${requestId} completed successfully with vendor ${vendor}`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error(`Error processing job ${requestId}:`, error);
      await this.updateJobResult(requestId, "failed", null, errorMessage);
    }
  }

  private async selectVendor(payload: any): Promise<string> {

    // For demo, use payload type to determine vendor
    if (payload.type === "sync" || !payload.type) {
      return "syncVendor";
    } else {
      return "asyncVendor";
    }
  }

  private async updateJobStatus(requestId: string, status: string) {
    try {
      const result = await JobModel.updateOne(
        { requestId },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        this.logger.warn(
          `Job ${requestId} not found when updating status to ${status}`
        );
      } else {
        this.logger.debug(`Job ${requestId} status updated to ${status}`);
      }
    } catch (error) {
      this.logger.error(`Failed to update job status for ${requestId}:`, error);
      throw error;
    }
  }

  private async updateJobResult(
    requestId: string,
    status: string,
    result: any,
    error?: string
  ) {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (result !== null) {
        updateData.result = result;
      }
      if (error) {
        updateData.error = error;
      }

      const updateResult = await JobModel.updateOne(
        { requestId },
        { $set: updateData }
      );

      if (updateResult.matchedCount === 0) {
        this.logger.warn(`Job ${requestId} not found when updating result`);
      } else {
        this.logger.debug(`Job ${requestId} result updated - status: ${status}`);
      }
    } catch (dbError) {
      this.logger.error(`Failed to update job result for ${requestId}:`, dbError);
      throw dbError;
    }
  }

  async stop() {
    this.isRunning = false;
    this.logger.info("Stopping background worker...");

    // Close Mongoose connection
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
      this.logger.info("Worker: Mongoose connection closed");
    }

    if (this.redisClient) {
      await this.redisClient.quit();
      this.logger.info("Worker: Redis connection closed");
    }
  }
}

// Start worker
const config = new Configuration();
const logger = new Logger('background-worker');
const worker = new BackgroundWorker(config, logger);

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received in worker");
  await worker.stop();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received in worker");
  await worker.stop();
  process.exit(0);
});

worker.initialize().then(() => {
  worker.start();
});
