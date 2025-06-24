import request from 'supertest';
import { VendorDataFetchServer } from '../src/server';
import { ApplicationContainer } from '../src/container/DIContainer';
import { IJobRepository, IJobQueue, ILogger } from '../src/interfaces/services';

// Mock dependencies
const mockJobRepository: jest.Mocked<IJobRepository> = {
  create: jest.fn(),
  findById: jest.fn(),
  updateStatus: jest.fn(),
  updateResult: jest.fn(),
  healthCheck: jest.fn(),
  findByStatus: jest.fn(),
  findByVendor: jest.fn(),
  getRecentJobs: jest.fn(),
  getJobStats: jest.fn()
};

const mockJobQueue: jest.Mocked<IJobQueue> = {
  connect: jest.fn(),
  addJob: jest.fn(),
  consumeJobs: jest.fn(),
  acknowledgeJob: jest.fn(),
  disconnect: jest.fn()
};

const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

const mockVendorClient = {
  healthCheckAll: jest.fn().mockResolvedValue(new Map([
    ['syncVendor', true],
    ['asyncVendor', true]
  ]))
};

// Mock container
const mockContainer: jest.Mocked<ApplicationContainer> = {
  initialize: jest.fn(),
  shutdown: jest.fn(),
  get: jest.fn(),
  getJobRepository: jest.fn(() => mockJobRepository),
  getJobQueue: jest.fn(() => mockJobQueue),
  getLogger: jest.fn(() => mockLogger),
  getConfiguration: jest.fn(),
  getVendorClient: jest.fn(() => mockVendorClient)
} as any;

describe('VendorDataFetchServer', () => {
  let server: VendorDataFetchServer;
  let app: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockJobRepository.healthCheck.mockResolvedValue(true);
    mockJobRepository.create.mockResolvedValue();
    mockJobQueue.addJob.mockResolvedValue();
    
    server = new VendorDataFetchServer(mockContainer);
    app = server.getApp();
  });

  describe('Health Check Endpoint', () => {
    test('should return healthy status when all services are up', async () => {
      mockJobRepository.healthCheck.mockResolvedValue(true);
      
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        components: {
          database: 'healthy',
          vendors: {
            syncVendor: true,
            asyncVendor: true
          }
        }
      });
    });

    test('should return degraded status when database is down', async () => {
      mockJobRepository.healthCheck.mockResolvedValue(false);
      
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.components.database).toBe('unhealthy');
    });
  });

  describe('Create Job Endpoint', () => {
    test('should create job with valid payload', async () => {
      const jobPayload = {
        vendor: 'vendor-a',
        data: { key: 'value' }
      };

      const response = await request(app)
        .post('/jobs')
        .send(jobPayload)
        .expect(200);

      expect(response.body).toHaveProperty('request_id');
      expect(typeof response.body.request_id).toBe('string');
      
      expect(mockJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          payload: jobPayload
        })
      );
      
      expect(mockJobQueue.addJob).toHaveBeenCalledWith(
        response.body.request_id,
        jobPayload
      );
    });

    test('should reject job with missing required fields', async () => {
      const jobPayload = {};

      const response = await request(app)
        .post('/jobs')
        .send(jobPayload)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(mockJobRepository.create).not.toHaveBeenCalled();
      expect(mockJobQueue.addJob).not.toHaveBeenCalled();
    });
  });

  describe('Get Job Status Endpoint', () => {
    test('should return job status for existing job', async () => {
      const mockJob = {
        requestId: 'test-request-id',
        vendor: 'vendor-a',
        status: 'complete' as const,
        payload: { vendor: 'vendor-a', data: { key: 'value' } },
        result: { success: true },
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-01')
      };

      mockJobRepository.findById.mockResolvedValue(mockJob);

      const response = await request(app)
        .get('/jobs/test-request-id')
        .expect(200);

      // The actual response format uses snake_case and only includes certain fields
      expect(response.body).toEqual({
        status: 'complete',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        result: { success: true }
      });
    });

    test('should return 404 for non-existent job', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .get('/jobs/non-existent-id')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Job not found');
    });
  });

  describe('Vendor Webhook Endpoint', () => {
    test('should process valid webhook payload', async () => {
      const webhookPayload = {
        requestId: 'test-request-id',
        status: 'complete',
        result: { data: 'webhook-result' }
      };

      mockJobRepository.updateResult.mockResolvedValue();

      const response = await request(app)
        .post('/vendor-webhook/syncVendor')
        .send(webhookPayload)
        .expect(200);

      expect(response.body).toEqual({ success: true });
    });
  });

  describe('Error Handling', () => {
    test('should handle 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/unknown-route')
        .expect(404);

      // The actual error message is "Not found" not "Route not found"
      expect(response.body).toHaveProperty('error', 'Not found');
    });
  });

  describe('CORS', () => {
    test('should include CORS headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });

  describe('Server Lifecycle', () => {
    test('should shutdown gracefully', async () => {
      await server.shutdown();
      
      expect(mockContainer.shutdown).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Shutting down server...');
    });
  });
});
