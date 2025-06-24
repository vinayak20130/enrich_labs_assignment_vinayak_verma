import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

// Track POST vs GET performance separately - they behave very differently
const postSuccessRate = new Rate('post_requests_success');
const getSuccessRate = new Rate('get_requests_success');
const postCount = new Counter('post_requests_total');
const getCount = new Counter('get_requests_total');

// 60-second test with 200 users hammering the API
// These thresholds are realistic for a production system
export const options = {
  vus: 200,        // 200 virtual users
  duration: '60s', // Run for exactly 1 minute
  thresholds: {
    http_req_duration: ['p(95)<2000'],      // 95% under 2 seconds
    http_req_failed: ['rate<0.1'],          // Less than 10% failures
    post_requests_success: ['rate>0.9'],    // 90%+ POST success
    get_requests_success: ['rate>0.9'],     // 90%+ GET success
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SYNC_VENDOR_URL = __ENV.SYNC_VENDOR_URL || 'http://localhost:3001';
const ASYNC_VENDOR_URL = __ENV.ASYNC_VENDOR_URL || 'http://localhost:3002';

let createdJobIds = [];

export function setup() {
  console.log('Starting 60-second load test with 200 concurrent users');
  console.log(`Target: ${BASE_URL}`);
  
  // Health check
  const health = http.get(`${BASE_URL}/health`);
  if (!check(health, { 'API healthy': (r) => r.status === 200 })) {
    throw new Error('API health check failed');
  }
  
  return { baseUrl: BASE_URL };
}

export default function() {
  // Mix of POST and GET requests (70% POST, 30% GET)
  if (Math.random() < 0.7) {
    // POST requests - Create jobs
    createJob();
  } else {
    // GET requests - Check job status or health
    if (Math.random() < 0.5 && createdJobIds.length > 0) {
      checkJobStatus();
    } else {
      checkHealth();
    }
  }
  
  sleep(0.1);
}

function createJob() {
  const vendors = ['syncVendor', 'asyncVendor'];
  const types = ['user_data', 'analytics', 'machine_learning', 'financial'];
  
  const payload = {
    vendor: vendors[Math.floor(Math.random() * vendors.length)],
    type: types[Math.floor(Math.random() * types.length)],
    userId: Math.floor(Math.random() * 1000),
    timestamp: new Date().toISOString(),
    testRun: 'load-test-200users'
  };

  const response = http.post(
    `${BASE_URL}/jobs`,
    JSON.stringify(payload),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const success = check(response, {
    'POST job creation status 200': (r) => r.status === 200,
    'POST response has request_id': (r) => {
      try {
        return JSON.parse(r.body).request_id;
      } catch (e) {
        return false;
      }
    },
  });

  postSuccessRate.add(success);
  postCount.add(1);

  if (success && response.status === 200) {
    try {
      const jobId = JSON.parse(response.body).request_id;
      createdJobIds.push(jobId);
      if (createdJobIds.length > 100) {
        createdJobIds = createdJobIds.slice(-50);
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
}

function checkJobStatus() {
  if (createdJobIds.length === 0) return;
  
  const jobId = createdJobIds[Math.floor(Math.random() * createdJobIds.length)];
  const response = http.get(`${BASE_URL}/jobs/${jobId}`);

  const success = check(response, {
    'GET job status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  getSuccessRate.add(success);
  getCount.add(1);
}

function checkHealth() {
  const endpoints = [
    `${BASE_URL}/health`,
    `${SYNC_VENDOR_URL}/health`,
    `${ASYNC_VENDOR_URL}/health`
  ];
  
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  const response = http.get(endpoint);

  const success = check(response, {
    'GET health check 200': (r) => r.status === 200,
  });

  getSuccessRate.add(success);
  getCount.add(1);
}

export function teardown(data) {
  console.log('='.repeat(50));
  console.log('60-SECOND LOAD TEST COMPLETED');
  console.log(`POST requests: ${postCount.count}`);
  console.log(`GET requests: ${getCount.count}`);
  console.log(`Total requests: ${postCount.count + getCount.count}`);
  console.log(`RPS: ${((postCount.count + getCount.count) / 60).toFixed(1)}`);
  console.log('='.repeat(50));
}
