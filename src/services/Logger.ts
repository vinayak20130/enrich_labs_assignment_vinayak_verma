import { ILogger } from '../interfaces/services';
import winston from 'winston';

// Logger implementation following Single Responsibility Principle
export class Logger implements ILogger {
  private logger: winston.Logger;

  constructor(serviceName: string = 'vendor-service') {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.label({ label: serviceName }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({ 
          filename: `logs/${serviceName}.log`,
          level: 'info'
        }),
        new winston.transports.File({ 
          filename: `logs/${serviceName}-error.log`,
          level: 'error'
        })
      ]
    });
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  error(message: string, error?: any): void {
    this.logger.error(message, { error: error?.message || error, stack: error?.stack });
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  // Factory method for creating service-specific loggers
  static create(serviceName: string): Logger {
    return new Logger(serviceName);
  }
}
