import express from 'express';
import axios from 'axios';
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

// Simulate async processing delays
const MIN_PROCESSING_DELAY_MS = 2000;
const MAX_PROCESSING_DELAY_MS = 8000;

// Store pending requests
const pendingRequests = new Map();

// Webhook retry mechanism
async function sendWebhookWithRetry(webhookUrl: string, payload: any, maxRetries: number = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await axios.post(webhookUrl, payload, {
        timeout: 5000, // 5 second timeout for webhook calls
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AsyncVendor-Webhook/1.0'
        }
      });
      
      logger.info(`Webhook delivered successfully`, { 
        requestId: payload.requestId, 
        attempt, 
        webhookUrl 
      });
      return; // Success!
      
    } catch (error) {
      logger.warn(`Webhook delivery failed (attempt ${attempt}/${maxRetries})`, { 
        requestId: payload.requestId, 
        error: error instanceof Error ? error.message : 'Unknown error',
        webhookUrl 
      });
      
      if (attempt === maxRetries) {
        throw error; // Final attempt failed
      }
      
      // Exponential backoff: wait 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
// Mock data generator for async responses
function generateAsyncMockData(payload: any) {
  const baseData = {
    id: _.random(1000, 9999),
    timestamp: new Date().toISOString(),
    vendor: 'AsyncVendor',
    version: '1.0.0',
    asyncProcessed: true
  };

  if (payload.type === 'complex_analysis') {
    return {
      ...baseData,
      analysis: {
        complexity: _.sample(['high', 'medium', 'low']),
        confidence: _.round(_.random(0.7, 0.99), 2),
        insights: _.sampleSize([
          'Market trend is positive',
          'Risk factors detected',
          'Growth opportunity identified',
          'Optimization potential found',
          'Anomaly pattern detected'
        ], _.random(2, 4)),
        metrics: {
          score: _.random(70, 95),
          accuracy: _.round(_.random(0.85, 0.98), 2),
          completeness: _.round(_.random(0.8, 1.0), 2)
        },
        recommendations: _.sampleSize([
          'Increase sampling frequency',
          'Review data quality',
          'Expand analysis scope',
          'Implement monitoring',
          'Schedule follow-up'
        ], _.random(1, 3))
      }
    };
  } else if (payload.type === 'machine_learning') {
    return {
      ...baseData,
      mlResults: {
        modelId: `ML${_.random(1000, 9999)}`,
        algorithm: _.sample(['random_forest', 'neural_network', 'gradient_boost']),
        accuracy: _.round(_.random(0.75, 0.95), 3),
        predictions: _.times(_.random(5, 15), () => ({
          id: _.random(1, 1000),
          prediction: _.round(_.random(0, 1), 3),
          confidence: _.round(_.random(0.6, 0.9), 2)
        })),
        featureImportance: {
          feature1: _.round(_.random(0.1, 0.4), 2),
          feature2: _.round(_.random(0.1, 0.3), 2),
          feature3: _.round(_.random(0.1, 0.2), 2)
        }
      }
    };
  } else if (payload.type === 'data_enrichment') {
    return {
      ...baseData,
      enrichment: {
        originalRecords: payload.recordCount || _.random(100, 1000),
        enrichedRecords: _.random(80, 95),
        enrichmentRate: _.round(_.random(0.8, 0.95), 2),
        newFields: _.sampleSize([
          'demographic_info',
          'social_profiles',
          'company_data',
          'geographic_details',
          'behavioral_data'
        ], _.random(2, 4)),
        qualityScore: _.round(_.random(0.85, 0.98), 2)
      }
    };
  } else {
    // Default async response
    return {
      ...baseData,
      data: {
        processed: true,
        originalPayload: payload,
        asyncId: `ASYNC${_.random(10000, 99999)}`,
        description: 'Default async response',
        processingMetrics: {
          totalTime: _.random(2000, 8000),
          stages: [
            { name: 'validation', duration: _.random(100, 500) },
            { name: 'processing', duration: _.random(1000, 5000) },
            { name: 'enrichment', duration: _.random(500, 2000) },
            { name: 'finalization', duration: _.random(100, 300) }
          ]
        }
      }
    };
  }
}

// Process request asynchronously
async function processRequestAsync(requestId: string, payload: any, webhookUrl: string) {
  try {
    // Simulate variable processing time
    const processingTime = _.random(MIN_PROCESSING_DELAY_MS, MAX_PROCESSING_DELAY_MS);
    
    logger.info(`AsyncVendor starting background processing for ${requestId}`, {
      estimatedTime: processingTime
    });

    await new Promise(resolve => setTimeout(resolve, processingTime));

    // Simulate occasional failures (reduced failure rate)
    if (_.random(1, 100) <= 3) { // 3% failure rate (reduced from 8%)
      logger.error(`AsyncVendor simulated failure for ${requestId}`);
      
      await sendWebhookWithRetry(webhookUrl, {
        requestId,
        status: 'failed',
        error: 'Simulated async processing error',
        timestamp: new Date().toISOString(),
        vendor: 'AsyncVendor'
      });
      
      pendingRequests.delete(requestId);
      return;
    }

    // Generate response data
    const responseData = generateAsyncMockData(payload);

    // Send webhook with results (with retry logic)
    await sendWebhookWithRetry(webhookUrl, {
      requestId,
      status: 'complete',
      result: responseData,
      timestamp: new Date().toISOString(),
      vendor: 'AsyncVendor',
      processingTime
    });

    logger.info(`AsyncVendor completed background processing for ${requestId}`);
    pendingRequests.delete(requestId);

  } catch (error) {
    logger.error(`AsyncVendor webhook error for ${requestId}:`, error);
    
    try {
      // Try to send error webhook with retry
      await sendWebhookWithRetry(webhookUrl, {
        requestId,
        status: 'failed',
        error: 'Webhook delivery failed',
        timestamp: new Date().toISOString(),
        vendor: 'AsyncVendor'
      });
    } catch (webhookError) {
      logger.error(`AsyncVendor failed to send error webhook for ${requestId}:`, webhookError);
    }
    
    pendingRequests.delete(requestId);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    vendor: 'AsyncVendor',
    pendingRequests: pendingRequests.size,
    timestamp: new Date().toISOString()
  });
});

// Main async data endpoint
app.post('/api/data', async (req, res) => {
  // Fix for the string | string[] issue
  const requestIdHeader = req.headers['x-request-id'];
  const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader || 'unknown';
  const { webhookUrl, ...payload } = req.body;
  
  try {
    logger.info(`AsyncVendor received request ${requestId}`, {
      payload,
      webhookUrl
    });

    if (!webhookUrl) {
      return res.status(400).json({
        error: 'webhookUrl is required for async processing',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Store request info
    pendingRequests.set(requestId, {
      payload,
      webhookUrl,
      startTime: Date.now()
    });

    // Start async processing
    processRequestAsync(requestId, payload, webhookUrl).catch(error => {
      logger.error(`Unhandled error in async processing for ${requestId}:`, error);
    });

    // Return immediate acknowledgment
    res.json({
      accepted: true,
      requestId,
      status: 'processing',
      estimatedCompletion: new Date(Date.now() + _.random(MIN_PROCESSING_DELAY_MS, MAX_PROCESSING_DELAY_MS)).toISOString(),
      vendor: 'AsyncVendor',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(`AsyncVendor error for request ${requestId}:`, error);
    res.status(500).json({
      error: 'Internal vendor error',
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Status check endpoint
app.get('/api/status/:requestId', (req, res) => {
  const { requestId } = req.params;
  const request = pendingRequests.get(requestId);
  
  if (!request) {
    return res.status(404).json({
      error: 'Request not found',
      requestId,
      timestamp: new Date().toISOString()
    });
  }

  const elapsed = Date.now() - request.startTime;
  const estimatedTotal = _.random(MIN_PROCESSING_DELAY_MS, MAX_PROCESSING_DELAY_MS);
  const progress = Math.min(elapsed / estimatedTotal, 0.95);

  res.json({
    requestId,
    status: 'processing',
    progress: _.round(progress, 2),
    elapsedTime: elapsed,
    vendor: 'AsyncVendor',
    timestamp: new Date().toISOString()
  });
});

// Rate limit info endpoint
app.get('/api/rate-limit', (req, res) => {
  res.json({
    vendor: 'AsyncVendor',
    rateLimit: {
      requestsPerMinute: 30,
      windowSize: '1 minute',
      burstAllowed: 5,
      concurrentRequests: 10
    },
    documentation: 'https://docs.asyncvendor.com/rate-limits'
  });
});

const PORT = process.env.ASYNC_VENDOR_PORT || 3002;

app.listen(PORT, () => {
  logger.info(`AsyncVendor mock server running on port ${PORT}`);
});

export { app };