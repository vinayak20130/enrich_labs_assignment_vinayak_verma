# API Testing Commands

## Health Check
```bash
curl -X GET http://localhost:3000/health
```

## Create a Sync Job
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sync",
    "category": "user_data",
    "userId": 123,
    "timestamp": "2025-06-22T10:00:00Z"
  }'
```

## Create an Async Job
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "async",
    "category": "complex_analysis",
    "dataSize": 500,
    "priority": "high"
  }'
```

## Check Job Status (replace {REQUEST_ID} with actual ID)
```bash
curl -X GET http://localhost:3000/jobs/{REQUEST_ID}
```

## Example: Complete workflow
```bash
# 1. Create a job and capture request_id
RESPONSE=$(curl -s -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "sync", "category": "analytics", "period": "7d"}')

# 2. Extract request_id (requires jq)
REQUEST_ID=$(echo $RESPONSE | jq -r '.request_id')
echo "Created job with ID: $REQUEST_ID"

# 3. Check status
curl -X GET http://localhost:3000/jobs/$REQUEST_ID

# 4. Wait a bit and check again
sleep 2
curl -X GET http://localhost:3000/jobs/$REQUEST_ID
```

## Test Different Payload Types

### Financial Data
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sync",
    "category": "financial",
    "accountId": "ACC123456",
    "period": "30d"
  }'
```

### Machine Learning Job (Async)
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "async",
    "category": "machine_learning",
    "algorithm": "random_forest",
    "features": 15,
    "training_data_size": 10000
  }'
```

### Data Enrichment (Async)
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "async",
    "category": "data_enrichment",
    "recordCount": 500,
    "sources": ["internal", "external"],
    "enrichment_level": "comprehensive"
  }'
```

## Mock Vendor Health Checks
```bash
# Sync Vendor
curl -X GET http://localhost:3001/health

# Async Vendor  
curl -X GET http://localhost:3002/health
```

## Rate Limit Information
```bash
# Sync Vendor Rate Limits
curl -X GET http://localhost:3001/api/rate-limit

# Async Vendor Rate Limits
curl -X GET http://localhost:3002/api/rate-limit
```

## Bulk Testing Script
```bash
#!/bin/bash
echo "Creating multiple jobs for testing..."

for i in {1..5}; do
  echo "Creating job $i..."
  curl -s -X POST http://localhost:3000/jobs \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"sync\", \"testId\": $i, \"timestamp\": \"$(date -Iseconds)\"}" | jq '.request_id'
  sleep 1
done
```
