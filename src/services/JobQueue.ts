import { createClient, RedisClientType } from "redis";
import { IJobQueue, ILogger } from "../interfaces/services";
import { QueueMessage } from "../types/domain";
import { Configuration } from "./Configuration"

export class JobQueue implements IJobQueue {
  private redisClient: RedisClientType;
  private readonly queueName = "job-queue";
  
  constructor(
    private logger: ILogger,
    private config: Configuration
  ) {
    this.redisClient = createClient({
      url: this.config.getRedisUrl(),
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
          return Math.min(retries * 100, 3000);
        },
      },
      commandsQueueMaxLength: 1000,
    });
  }

  async connect(): Promise<void> {
    await this.redisClient.connect();
    this.logger.info("JobQueue connected to Redis");
  }

  async addJob(requestId: string, payload: any): Promise<void> {
    try {
      await this.redisClient.xAdd(this.queueName, "*", {
        requestId,
        payload: JSON.stringify(payload),
        timestamp: new Date().toISOString(),
      });

      this.logger.info(`Job added to queue`, { requestId });
    } catch (error) {
      this.logger.error(`Failed to add job to queue`, { requestId, error });
      throw error;
    }
  }

  async consumeJobs(
    consumerGroup: string,
    consumerId: string
  ): Promise<QueueMessage[]> {
    try {
      const messages = await this.redisClient.xReadGroup(
        consumerGroup,
        consumerId,
        { key: this.queueName, id: ">" },
        { COUNT: 1, BLOCK: 1000 }
      );

      if (!messages || messages.length === 0) {
        return [];
      }

      return messages[0].messages.map((msg: any) => ({
        id: msg.id,
        message: msg.message,
      }));
    } catch (error) {
      this.logger.error("Failed to consume jobs from queue", error);
      throw error;
    }
  }

  async acknowledgeJob(messageId: string): Promise<void> {
    try {
      await this.redisClient.xAck(this.queueName, "workers", messageId);
      this.logger.debug(`Job acknowledged`, { messageId });
    } catch (error) {
      this.logger.error(`Failed to acknowledge job`, { messageId, error });
      throw error;
    }
  }
  async disconnect(): Promise<void> {
    await this.redisClient.quit();
    this.logger.info("JobQueue disconnected from Redis");
  }
}
