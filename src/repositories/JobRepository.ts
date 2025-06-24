import { MongoClient, Db } from 'mongodb';
import { IJobRepository, ILogger, IConfiguration } from '../interfaces/services';
import { Job } from '../types/domain';
import { JobModel, IJobDocument } from '../models/Job';
import mongoose from 'mongoose';

export class JobRepository implements IJobRepository {
  constructor(
    private logger: ILogger,
    private config: IConfiguration
  ) {}

  async create(job: Job): Promise<void> {
    try {
      const jobDoc = new JobModel(job);
      await jobDoc.save();
      this.logger.info(`Job created successfully with Mongoose validation`, { 
        requestId: job.requestId,
        status: job.status 
      });
    } catch (error) {
      this.logger.error(`Failed to create job`, error);
      
      if (error instanceof mongoose.Error.ValidationError) {
        const validationErrors = Object.values(error.errors).map(err => err.message);
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }
      
      if (error instanceof Error && error.message.includes('duplicate key')) {
        throw new Error(`Job with requestId ${job.requestId} already exists`);
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create job: ${errorMessage}`);
    }
  }

  async findById(requestId: string): Promise<Job | null> {
    try {
      const jobDoc = await JobModel.findOne({ requestId }).lean();
      
      if (!jobDoc) {
        this.logger.debug(`Job not found`, { requestId });
        return null;
      }

      // Convert Mongoose document to domain object
      const job: Job = {
        requestId: jobDoc.requestId,
        status: jobDoc.status,
        payload: jobDoc.payload,
        result: jobDoc.result,
        error: jobDoc.error,
        vendor: jobDoc.vendor,
        createdAt: jobDoc.createdAt,
        updatedAt: jobDoc.updatedAt
      };

      this.logger.debug(`Job found`, { requestId, status: job.status });
      return job;
    } catch (error) {
      this.logger.error(`Failed to find job by ID`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to find job: ${errorMessage}`);
    }
  }

  async updateStatus(requestId: string, status: Job['status']): Promise<void> {
    try {
      const result = await JobModel.updateOne(
        { requestId },
        { 
          $set: { 
            status,
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount === 0) {
        throw new Error(`Job with requestId ${requestId} not found`);
      }

      this.logger.info(`Job status updated using Mongoose`, { 
        requestId, 
        status,
        modifiedCount: result.modifiedCount 
      });
    } catch (error) {
      this.logger.error(`Failed to update job status`, error);
      
      if (error instanceof mongoose.Error.ValidationError) {
        const validationErrors = Object.values(error.errors).map(err => err.message);
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to update job status: ${errorMessage}`);
    }
  }

  async updateResult(requestId: string, status: Job['status'], result?: any, error?: string): Promise<void> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date()
      };

      if (result !== undefined) {
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
        throw new Error(`Job with requestId ${requestId} not found`);
      }

      this.logger.info(`Job result updated using Mongoose`, { 
        requestId, 
        status,
        hasResult: result !== undefined,
        hasError: !!error,
        modifiedCount: updateResult.modifiedCount
      });
    } catch (error) {
      this.logger.error(`Failed to update job result`, error);
      
      if (error instanceof mongoose.Error.ValidationError) {
        const validationErrors = Object.values(error.errors).map(err => err.message);
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to update job result: ${errorMessage}`);
    }
  }

  // Additional convenience methods using Mongoose features
  async findByStatus(status: Job['status'], limit: number = 100): Promise<Job[]> {
    try {
      const jobDocs = await JobModel.findByStatus(status).limit(limit).lean().exec();
      return jobDocs.map(this.mapDocumentToJob);
    } catch (error) {
      this.logger.error(`Failed to find jobs by status`, error);
      throw new Error(`Failed to find jobs by status: ${error}`);
    }
  }

  async findByVendor(vendor: string, limit: number = 100): Promise<Job[]> {
    try {
      const jobDocs = await JobModel.findByVendor(vendor).limit(limit).lean().exec();
      return jobDocs.map(this.mapDocumentToJob);
    } catch (error) {
      this.logger.error(`Failed to find jobs by vendor`, error);
      throw new Error(`Failed to find jobs by vendor: ${error}`);
    }
  }

  async getRecentJobs(hours: number = 24): Promise<Job[]> {
    try {
      const jobDocs = await JobModel.findRecentJobs(hours).lean().exec();
      return jobDocs.map(this.mapDocumentToJob);
    } catch (error) {
      this.logger.error(`Failed to get recent jobs`, error);
      throw new Error(`Failed to get recent jobs: ${error}`);
    }
  }

  async getJobStats(): Promise<{ total: number; byStatus: Record<string, number>; byVendor: Record<string, number> }> {
    try {
      const [total, statusStats, vendorStats] = await Promise.all([
        JobModel.countDocuments(),
        JobModel.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        JobModel.aggregate([
          { $match: { vendor: { $ne: null } } },
          { $group: { _id: '$vendor', count: { $sum: 1 } } }
        ])
      ]);

      const byStatus: Record<string, number> = {};
      statusStats.forEach(stat => {
        byStatus[stat._id] = stat.count;
      });

      const byVendor: Record<string, number> = {};
      vendorStats.forEach(stat => {
        byVendor[stat._id] = stat.count;
      });

      return { total, byStatus, byVendor };
    } catch (error) {
      this.logger.error(`Failed to get job statistics`, error);
      throw new Error(`Failed to get job statistics: ${error}`);
    }
  }

  // Health check method using Mongoose
  async healthCheck(): Promise<boolean> {
    try {
      // Use Mongoose connection state
      const connection = mongoose.connection;
      if (connection.readyState !== 1) { // 1 = connected
        return false;
      }
      
      // Test with a simple count operation
      await JobModel.countDocuments().limit(1);
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return false;
    }
  }

  // Private helper method to convert Mongoose document to domain object
  private mapDocumentToJob(doc: any): Job {
    return {
      requestId: doc.requestId,
      status: doc.status,
      payload: doc.payload,
      result: doc.result,
      error: doc.error,
      vendor: doc.vendor,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }
}
