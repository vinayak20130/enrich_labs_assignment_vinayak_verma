# Multi-stage Dockerfile for the vendor service

# Build stage - includes all dependencies for building
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN npm ci && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production base - clean image with only runtime dependencies
FROM node:18-alpine AS base

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create logs directory
RUN mkdir -p logs

# API Service Target
FROM base AS api
EXPOSE 3000
CMD ["npm", "start"]

# Worker Service Target  
FROM base AS worker
CMD ["npm", "run", "worker"]

# Sync Vendor Mock Target
FROM base AS sync-vendor
EXPOSE 3001
CMD ["node", "dist/src/vendors/mocks/syncVendor.js"]

# Async Vendor Mock Target
FROM base AS async-vendor
EXPOSE 3002
CMD ["node", "dist/src/vendors/mocks/asyncVendor.js"]