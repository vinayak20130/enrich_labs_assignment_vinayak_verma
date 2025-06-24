import mongoose, { Schema, Document, Model } from 'mongoose';

// Job document interface - this is what our jobs look like in MongoDB
export interface IJobDocument extends Document {
  requestId: string;    // UUID to track this specific job
  status: 'pending' | 'processing' | 'complete' | 'failed';  // Job lifecycle
  payload: any;         // Whatever data the client sent us
  result?: any;         // What we got back from the vendor (if successful)
  error?: string;       // Error message if something went wrong
  vendor?: string;      // Which vendor processed this (syncVendor/asyncVendor)
  createdAt: Date;      // When this job was submitted
  updatedAt: Date;      // Last time we touched this job
}

// MongoDB schema with validation - learned this the hard way, validate everything!
const JobSchema = new Schema<IJobDocument>({
  requestId: {
    type: String,
    required: [true, 'Request ID is required'],
    unique: true,        // Prevents duplicate job submissions
    index: true,         // Fast lookups by job ID
    trim: true,          // Remove whitespace because users are messy
    validate: {
      // UUID v4 regex - ensures we only accept valid UUIDs
      validator: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      message: 'Request ID must be a valid UUID'
    }
  },
  status: {
    type: String,
    required: [true, 'Status is required'],
    enum: {
      // Only allow these 4 states - keeps the lifecycle simple
      values: ['pending', 'processing', 'complete', 'failed'],
      message: 'Status must be one of: pending, processing, complete, failed'
    },
    default: 'pending',  // All jobs start here
    index: true          // Status queries are super common
  },
  payload: {
    type: Schema.Types.Mixed,  // Accept any JSON object
    required: [true, 'Payload is required'],
    validate: {
      // Make sure it's actually an object, not a string or null
      validator: (v: any) => v !== null && typeof v === 'object',
      message: 'Payload must be a valid object'
    }
  },
  result: {
    type: Schema.Types.Mixed,
    default: null
  },
  error: {
    type: String,
    default: null,
    maxlength: [1000, 'Error message cannot exceed 1000 characters']
  },
  vendor: {
    type: String,
    default: null,
    index: true,
    trim: true
  }
}, {
  // Schema options
  timestamps: true, // Automatically manages createdAt and updatedAt
  collection: 'jobs',
  
  // Optimize for performance
  autoIndex: process.env.NODE_ENV !== 'production', // Only auto-create indexes in dev
  
  // JSON transform to clean up the output
  toJSON: {
    transform: (doc, ret) => {
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  },
  
  // Object transform
  toObject: {
    transform: (doc, ret) => {
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Compound indexes for common query patterns
JobSchema.index({ status: 1, createdAt: -1 }); // For paginated status queries
JobSchema.index({ vendor: 1, status: 1 }); // For vendor-specific analytics
JobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // TTL: 30 days

// Pre-save middleware for data validation and defaults
JobSchema.pre('save', function(next) {
  // Validate business rules
  if (this.status === 'complete' && !this.result && !this.error) {
    return next(new Error('Complete jobs must have either result or error'));
  }
  
  if (this.status === 'failed' && !this.error) {
    return next(new Error('Failed jobs must have an error message'));
  }
  
  next();
});

// Pre-update middleware to ensure updatedAt is always set
JobSchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

// Instance methods
JobSchema.methods.markAsProcessing = function(vendor: string) {
  this.status = 'processing';
  this.vendor = vendor;
  this.updatedAt = new Date();
  return this.save();
};

JobSchema.methods.markAsComplete = function(result: any) {
  this.status = 'complete';
  this.result = result;
  this.error = null;
  this.updatedAt = new Date();
  return this.save();
};

JobSchema.methods.markAsFailed = function(error: string) {
  this.status = 'failed';
  this.error = error;
  this.result = null;
  this.updatedAt = new Date();
  return this.save();
};

// Static methods
JobSchema.statics.findByStatus = function(status: string) {
  return this.find({ status }).sort({ createdAt: -1 });
};

JobSchema.statics.findByVendor = function(vendor: string) {
  return this.find({ vendor }).sort({ createdAt: -1 });
};

JobSchema.statics.findRecentJobs = function(hours: number = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 });
};

// Add type for static methods with Query return types
interface IJobModel extends Model<IJobDocument> {
  findByStatus(status: string): mongoose.Query<IJobDocument[], IJobDocument>;
  findByVendor(vendor: string): mongoose.Query<IJobDocument[], IJobDocument>;
  findRecentJobs(hours?: number): mongoose.Query<IJobDocument[], IJobDocument>;
}

// Create and export the model
export const JobModel = mongoose.model<IJobDocument, IJobModel>('Job', JobSchema);

// Export convenience types
export type JobStatus = 'pending' | 'processing' | 'complete' | 'failed';
export type JobDocument = IJobDocument;
