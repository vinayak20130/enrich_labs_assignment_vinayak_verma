import { JobQueue } from '../src/services/JobQueue';
import { ILogger } from '../src/interfaces/services';
import { Configuration } from '../src/services/Configuration';

// Mock Redis client
const mockRedisClient = {
  connect: jest.fn(),
  quit: jest.fn(),
  xAdd: jest.fn(),
  xReadGroup: jest.fn(),
  xAck: jest.fn(),
  xGroupCreate: jest.fn(),
  ping: jest.fn(),
  on: jest.fn(),
  off: jest.fn()
};

// Mock logger
const mockLogger: ILogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

// Mock Redis constructor
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

describe('JobQueue', () => {
  let jobQueue: JobQueue;
  let mockConfig: Configuration;
  const redisUrl = 'redis://localhost:6379';

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue(undefined);
    mockRedisClient.quit.mockResolvedValue(undefined);
    mockRedisClient.ping.mockResolvedValue('PONG');
    mockRedisClient.xAdd.mockResolvedValue('1234567890-0');
    mockRedisClient.xAck.mockResolvedValue(1);
    
    // Create mock configuration
    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'REDIS_URL') return redisUrl;
        return undefined;
      }),
      getNumber: jest.fn(),
      getBoolean: jest.fn(),
      getRedisUrl: jest.fn(() => redisUrl)
    } as any;
    
    jobQueue = new JobQueue(mockLogger, mockConfig);
  });

  describe('Connection Management', () => {
    test('should connect to Redis successfully', async () => {
      await jobQueue.connect();
      
      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('JobQueue connected to Redis');
    });

    test('should disconnect from Redis', async () => {
      await jobQueue.disconnect();
      
      expect(mockRedisClient.quit).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('JobQueue disconnected from Redis');
    });
  });

  describe('Job Management', () => {
    beforeEach(async () => {
      await jobQueue.connect();
    });

    test('should add job to queue', async () => {
      const requestId = 'test-request-123';
      const payload = { vendor: 'vendor-a', data: { key: 'value' } };
      
      await jobQueue.addJob(requestId, payload);
      
      expect(mockRedisClient.xAdd).toHaveBeenCalledWith(
        'job-queue',
        '*',
        {
          requestId,
          payload: JSON.stringify(payload),
          timestamp: expect.any(String)
        }
      );
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Job added to queue',
        { requestId }
      );
    });

    test('should consume jobs from queue', async () => {
      const mockStreamData = [
        {
          messages: [
            {
              id: '1234567890-0',
              message: {
                requestId: 'test-request-123',
                payload: '{"vendor":"vendor-a"}',
                timestamp: '2023-01-01T00:00:00.000Z'
              }
            }
          ]
        }
      ];
      
      mockRedisClient.xReadGroup.mockResolvedValue(mockStreamData);
      
      const messages = await jobQueue.consumeJobs('worker-group', 'worker-1');
      
      expect(mockRedisClient.xReadGroup).toHaveBeenCalledWith(
        'worker-group',
        'worker-1',
        { key: 'job-queue', id: '>' },
        { COUNT: 1, BLOCK: 1000 }
      );
      
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        id: '1234567890-0',
        message: {
          requestId: 'test-request-123',
          payload: '{"vendor":"vendor-a"}',
          timestamp: '2023-01-01T00:00:00.000Z'
        }
      });
    });

    test('should acknowledge processed job', async () => {
      const messageId = '1234567890-0';
      
      await jobQueue.acknowledgeJob(messageId);
      
      expect(mockRedisClient.xAck).toHaveBeenCalledWith('job-queue', 'workers', messageId);
      expect(mockLogger.debug).toHaveBeenCalledWith('Job acknowledged', { messageId });
    });

    test('should handle empty queue when consuming', async () => {
      mockRedisClient.xReadGroup.mockResolvedValue(null);
      
      const messages = await jobQueue.consumeJobs('worker-group', 'worker-1');
      
      expect(messages).toEqual([]);
    });
  });
});
