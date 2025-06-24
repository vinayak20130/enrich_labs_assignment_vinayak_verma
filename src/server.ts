import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { body, validationResult } from 'express-validator';
import { ApplicationContainer } from './container/DIContainer';
import { Job } from './types/domain';
import { ILogger, IJobRepository, IJobQueue } from './interfaces/services';
import { Configuration } from './services/Configuration';

// Main API server - handles job creation, status checks, and vendor webhooks
// I went with dependency injection here because it makes testing way easier
export class VendorDataFetchServer {
  private app: express.Application;
  private container: ApplicationContainer;
  
  // All the stuff we need injected from the container
  private logger: ILogger;
  private jobRepository: IJobRepository;
  private config: Configuration;
  private jobQueue: IJobQueue;

  constructor(container: ApplicationContainer) {
    this.container = container;
    this.logger = container.getLogger();
    this.jobRepository = container.getJobRepository();
    this.config = container.getConfiguration();
    this.jobQueue = container.getJobQueue();
    
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    this.app.use(cors()); // Allow cross-origin requests - you'll thank me later
    this.app.use(express.json({ limit: '10mb' })); // Generous limit for large payloads
    this.app.use(express.urlencoded({ extended: true }));
    
    // Log every request - super helpful for debugging production issues
    this.app.use((req, res, next) => {
      this.logger.info(`${req.method} ${req.path}`, { 
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', async (req, res) => {
      try {
        const health = await this.getHealthStatus();
        res.json(health);
      } catch (error) {
        this.logger.error('Health check failed:', error);
        res.status(503).json({ 
          status: 'unhealthy', 
          timestamp: new Date().toISOString(),
          error: 'Service unavailable'
        });
      }
    });

    // POST /jobs - Create new job
    this.app.post('/jobs', 
      this.validateJobPayload(),
      this.handleCreateJob.bind(this)
    );

    // GET /jobs/:requestId - Get job status
    this.app.get('/jobs/:requestId', 
      this.handleGetJob.bind(this)
    );

    // POST /vendor-webhook/:vendor - Webhook for async responses
    this.app.post('/vendor-webhook/:vendor', 
      this.handleVendorWebhook.bind(this)
    );
  }

  private validateJobPayload() {
    return [
      body().isObject().withMessage('Request body must be a valid JSON object'),
      body().custom((value) => {
        if (Object.keys(value).length === 0) {
          throw new Error('Request body cannot be empty');
        }
        return true;
      })
    ];
  }

  private async handleCreateJob(req: express.Request, res: express.Response): Promise<void> {
    try {
      // Basic validation - express-validator catches the obvious stuff
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ 
          error: 'Invalid request body', 
          details: errors.array() 
        });
        return;
      }

      const requestId = uuidv4(); // UUID v4 because it's practically collision-proof
      const job: Job = {
        requestId,
        status: 'pending', // Always starts pending, worker will pick it up
        payload: req.body, // Store whatever they sent us
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Two-step process: save to DB first, then queue
      // If queueing fails, at least we have a record of the job
      await this.jobRepository.create(job);
      await this.jobQueue.addJob(requestId, req.body);

      this.logger.info(`Job created and queued successfully`, { requestId });
      res.json({ request_id: requestId }); // Return the ID they'll use to check status

    } catch (error) {
      this.logger.error('Error creating job:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async handleGetJob(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { requestId } = req.params;
      
      if (!requestId) {
        res.status(400).json({ error: 'Request ID is required' });
        return;
      }

      // Hit the cache first - Redis is way faster than MongoDB
      const cachedJob = await this.getCachedJob(requestId);
      if (cachedJob) {
        this.logger.debug('Job found in cache', { requestId });
        const response = this.formatJobResponse(cachedJob);
        res.json(response);
        return;
      }

      // Cache miss, go to the database
      const job = await this.jobRepository.findById(requestId);
      
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      // Cache it for next time - saves DB hits on repeated status checks
      await this.cacheJob(requestId, job);

      const response = this.formatJobResponse(job);
      res.json(response);

    } catch (error) {
      this.logger.error('Error fetching job:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async handleVendorWebhook(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { vendor } = req.params;
      const { requestId, result, status, error } = req.body;

      if (!requestId) {
        res.status(400).json({ error: 'requestId is required' });
        return;
      }

      // Async vendors call this when they're done processing
      // Could be success with results, or failure with error details
      await this.jobRepository.updateResult(requestId, status || 'complete', result, error);

      // Blow away the cache since the job status just changed
      await this.invalidateJobCache(requestId);

      this.logger.info(`Webhook processed`, { vendor, requestId, status });
      res.json({ success: true });

    } catch (error) {
      this.logger.error('Error processing webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private formatJobResponse(job: Job): any {
    const response: any = {
      status: job.status,
      created_at: job.createdAt,
      updated_at: job.updatedAt
    };

    if (job.status === 'complete' && job.result) {
      response.result = job.result;
    } else if (job.status === 'failed' && job.error) {
      response.error = job.error;
    }

    return response;
  }
  
    private async getCachedJob(requestId: string): Promise<Job | null> {
      try {
        const redisClient = this.container.getRedisClient();
        const cachedData = await redisClient.get(`job:${requestId}`);
        
        if (cachedData) {
          return JSON.parse(cachedData);
        }
        
        return null;
      } catch (error) {
        this.logger.warn('Failed to get job from cache', { requestId, error });
        return null;
      }
    }
  
    private async cacheJob(requestId: string, job: Job): Promise<void> {
      try {
        const redisClient = this.container.getRedisClient();
        const cacheKey = `job:${requestId}`;
        const cacheData = JSON.stringify(job);
        
        // Cache for 5 minutes, or longer for completed/failed jobs
        const ttl = (job.status === 'complete' || job.status === 'failed') ? 3600 : 300;
        
        await redisClient.setEx(cacheKey, ttl, cacheData);
        this.logger.debug('Job cached successfully', { requestId, ttl });
      } catch (error) {
        this.logger.warn('Failed to cache job', { requestId, error });
      }
    }
  
    private async invalidateJobCache(requestId: string): Promise<void> {
      try {
        const redisClient = this.container.getRedisClient();
        await redisClient.del(`job:${requestId}`);
        this.logger.debug('Job cache invalidated', { requestId });
      } catch (error) {
        this.logger.warn('Failed to invalidate job cache', { requestId, error });
      }
    }
  private async getHealthStatus(): Promise<any> {
    const dbHealthy = await this.jobRepository.healthCheck();
    const vendorClient = this.container.getVendorClient();
    const vendorHealth = await vendorClient.healthCheckAll();
    
    const overallHealthy = dbHealthy && Array.from(vendorHealth.values()).every(v => v);
    
    return {
      status: overallHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      components: {
        database: dbHealthy ? 'healthy' : 'unhealthy',
        vendors: Object.fromEntries(vendorHealth.entries())
      }
    };
  }

  private setupErrorHandling(): void {
    this.app.use((req, res) => {
      res.status(404).json({ 
        error: 'Not found',
        path: req.path,
        method: req.method
      });
    });

    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error('Unhandled error:', error);
      
      if (res.headersSent) {
        return next(error);
      }
      
      res.status(500).json({ 
        error: 'Internal server error',
        ...(this.config.getNodeEnv() === 'development' && { 
          details: error.message,
          stack: error.stack 
        })
      });
    });
  }

  async start(): Promise<void> {
    const port = this.config.getPort();
    
    this.app.listen(port, () => {
      this.logger.info(`Server running on port ${port}`, {
        environment: this.config.getNodeEnv(),
        port
      });
      
      // Start job timeout checker
      this.startJobTimeoutChecker();
    });
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down server...');
    await this.container.shutdown();
  }
  
    // Timeout mechanism for async jobs
    private async checkAndTimeoutStaleJobs(): Promise<void> {
      try {
        const staleJobsTimeout = 5 * 60 * 1000; // 5 minutes
        const cutoffTime = new Date(Date.now() - staleJobsTimeout);
        
        const staleJobs = await this.jobRepository.findByStatus('processing');
        
        for (const job of staleJobs) {
          if (job.updatedAt < cutoffTime && job.vendor === 'asyncVendor') {
            this.logger.warn(`Timing out stale async job`, { 
              requestId: job.requestId, 
              age: Date.now() - job.updatedAt.getTime() 
            });
            
            await this.jobRepository.updateResult(
              job.requestId, 
              'failed', 
              null, 
              'Job timed out - no webhook received'
            );
            
            // Invalidate cache
            await this.invalidateJobCache(job.requestId);
          }
        }
      } catch (error) {
        this.logger.error('Error checking for stale jobs:', error);
      }
    }
  
    private startJobTimeoutChecker(): void {
      // Check for stale jobs every 2 minutes
      setInterval(() => {
        this.checkAndTimeoutStaleJobs().catch(error => {
          this.logger.error('Job timeout checker failed:', error);
        });
      }, 2 * 60 * 1000);
      
      this.logger.info('Job timeout checker started');
    }
  getApp(): express.Application {
    return this.app;
  }
}
