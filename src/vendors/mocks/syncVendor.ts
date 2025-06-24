import express from 'express';
import winston from 'winston';
import _ from 'lodash';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const app = express();
app.use(express.json());

// Simulate some processing time - real vendors aren't instant
const PROCESSING_DELAY_MS = 500;

// Generate realistic-looking fake data based on what the client requested
function generateMockData(payload: any) {
  const baseData = {
    id: _.random(1000, 9999),            // Random ID like real APIs
    timestamp: new Date().toISOString(),  // Always include timestamps
    vendor: 'SyncVendor',                // Identify which vendor responded
    version: '1.0.0'                     // Version info for API compatibility
  };

  // Different response shapes based on what they asked for
  if (payload.type === 'user_data') {
    return {
      ...baseData,
      userData: {
        userId: payload.userId || _.random(100, 999),
        name: `User ${_.random(1, 100)}`,
        email: `user${_.random(1, 100)}@example.com`,
        phone: `555-${_.random(1000, 9999)}`,
        address: {
          street: `${_.random(100, 999)} Main St`,
          city: 'Sample City',
          state: 'ST',
          zip: `${_.random(10000, 99999)}`
        },
        preferences: {
          notifications: _.sample([true, false]),
          theme: _.sample(['dark', 'light']),
          language: _.sample(['en', 'es', 'fr'])
        }
      }
    };
  } else if (payload.type === 'analytics') {
    return {
      ...baseData,
      analytics: {
        pageViews: _.random(1000, 50000),
        uniqueVisitors: _.random(100, 5000),
        bounceRate: _.round(_.random(0.2, 0.8), 2),
        avgSessionDuration: _.random(120, 600),
        topPages: [
          '/home',
          '/products',
          '/about',
          '/contact'
        ].slice(0, _.random(2, 4))
      }
    };
  } else if (payload.type === 'financial') {
    return {
      ...baseData,
      financial: {
        accountId: `ACC${_.random(100000, 999999)}`,
        balance: _.round(_.random(100, 10000), 2),
        currency: 'USD',
        transactions: _.times(_.random(3, 8), (i) => ({
          id: `TXN${_.random(100000, 999999)}`,
          amount: _.round(_.random(-500, 500), 2),
          description: _.sample([
            'Online Purchase',
            'ATM Withdrawal',
            'Direct Deposit',
            'Transfer',
            'Fee'
          ]),
          date: new Date(Date.now() - _.random(0, 30) * 24 * 60 * 60 * 1000).toISOString()
        }))
      }
    };
  } else {
    // Default response
    return {
      ...baseData,
      data: {
        processed: true,
        originalPayload: payload,
        randomValue: _.random(1, 1000),
        description: 'Default response from sync vendor',
        metadata: {
          processingTime: PROCESSING_DELAY_MS,
          dataSource: 'mock',
          quality: _.sample(['high', 'medium', 'low'])
        }
      }
    };
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    vendor: 'SyncVendor',
    timestamp: new Date().toISOString()
  });
});

// Main data endpoint
app.post('/api/data', async (req, res) => {
  const requestId = req.headers['x-request-id'] || 'unknown';
  
  try {
    logger.info(`SyncVendor received request ${requestId}`, {
      payload: req.body
    });

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, PROCESSING_DELAY_MS));

    // Randomly simulate some failures for testing
    if (_.random(1, 100) <= 5) { // 5% failure rate
      logger.error(`SyncVendor simulated error for request ${requestId}`);
      return res.status(500).json({
        error: 'Simulated vendor error',
        code: 'VENDOR_ERROR',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Generate mock response
    const responseData = generateMockData(req.body);

    logger.info(`SyncVendor completed request ${requestId}`, {
      dataType: req.body.type || 'default'
    });

    res.json({
      success: true,
      requestId,
      data: responseData,
      processingTime: PROCESSING_DELAY_MS,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(`SyncVendor error for request ${requestId}:`, error);
    res.status(500).json({
      error: 'Internal vendor error',
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Rate limit info endpoint
app.get('/api/rate-limit', (req, res) => {
  res.json({
    vendor: 'SyncVendor',
    rateLimit: {
      requestsPerMinute: 60,
      windowSize: '1 minute',
      burstAllowed: 10
    },
    documentation: 'https://docs.syncvendor.com/rate-limits'
  });
});

const PORT = process.env.SYNC_VENDOR_PORT || 3001;

app.listen(PORT, () => {
  logger.info(`SyncVendor mock server running on port ${PORT}`);
});

export { app };