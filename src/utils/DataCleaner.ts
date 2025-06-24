import _ from 'lodash';
import { IDataCleaner, ILogger } from '../interfaces/services';
import { CleaningRule } from '../types/domain';

// Data Cleaner implementation following Single Responsibility Principle
export class DataCleaner implements IDataCleaner {
  private piiFields: string[] = [];
  private cleaningRules: CleaningRule[] = [];

  constructor(private logger?: ILogger) {
    this.initializePiiFields();
    this.initializeCleaningRules();
  }

  private initializePiiFields(): void {
    // Common PII field names to remove
    this.piiFields = [
      'ssn', 'socialSecurityNumber', 'social_security_number',
      'creditCard', 'credit_card', 'creditCardNumber',
      'bankAccount', 'bank_account', 'routingNumber', 'routing_number',
      'password', 'pin', 'securityCode', 'security_code', 'cvv',
      'personalId', 'personal_id', 'driverLicense', 'drivers_license',
      'passport', 'taxId', 'tax_id'
    ];
  }

  private initializeCleaningRules(): void {
    this.cleaningRules = [
      // Email masking
      {
        field: 'email',
        action: 'mask',
        pattern: /@/g,
        replacement: '@***'
      },
      // Name partial masking
      {
        field: 'lastName',
        action: 'mask'
      }
    ];
  }

  clean(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    try {
      // Deep clone to avoid modifying original data
      const cleanedData = _.cloneDeep(data);
      const result = this.cleanObject(cleanedData);
      
      this.logger?.debug('Data cleaning completed', {
        originalFields: this.countFields(data),
        cleanedFields: this.countFields(result)
      });
      
      return result;
    } catch (error) {
      this.logger?.error('Error cleaning data:', error);
      return data;
    }
  }

  addCustomRule(rule: CleaningRule): void {
    this.cleaningRules.push(rule);
    this.logger?.info(`Added custom cleaning rule for field: ${rule.field}`);
  }

  // Add custom PII field
  addPiiField(fieldName: string): void {
    this.piiFields.push(fieldName);
    this.logger?.info(`Added custom PII field: ${fieldName}`);
  }

  private cleanObject(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.cleanObject(item));
    }

    if (obj && typeof obj === 'object') {
      const cleaned: any = {};

      for (const [key, value] of Object.entries(obj)) {
        // Check if field should be removed (PII)
        if (this.shouldRemoveField(key)) {
          this.logger?.debug(`Removed PII field: ${key}`);
          continue;
        }

        // Apply cleaning rules
        const cleanedValue = this.applyCleaningRules(key, value);
        
        // Recursively clean nested objects
        if (cleanedValue && typeof cleanedValue === 'object') {
          cleaned[key] = this.cleanObject(cleanedValue);
        } else {
          cleaned[key] = cleanedValue;
        }
      }

      return cleaned;
    }

    return obj;
  }

  private shouldRemoveField(fieldName: string): boolean {
    const normalizedFieldName = fieldName.toLowerCase();
    return this.piiFields.some(piiField => 
      normalizedFieldName.includes(piiField.toLowerCase())
    );
  }

  private applyCleaningRules(fieldName: string, value: any): any {
    if (typeof value !== 'string') {
      return value;
    }

    // Trim whitespace
    let cleanedValue = value.trim();

    // Apply specific cleaning rules for sensitive fields
    if (fieldName.toLowerCase().includes('email')) {
      cleanedValue = this.maskEmail(cleanedValue);
    } else if (fieldName.toLowerCase().includes('phone')) {
      cleanedValue = this.maskPhone(cleanedValue);
    } else if (fieldName.toLowerCase().includes('name')) {
      cleanedValue = this.maskName(cleanedValue);
    }

    return cleanedValue;
  }

  private maskEmail(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex > 3) {
      return email.substring(0, 3) + '***' + email.substring(atIndex);
    }
    return email;
  }

  private maskPhone(phone: string): string {
    // Simple phone masking
    if (phone.length > 4) {
      return phone.substring(0, 3) + '***' + phone.substring(phone.length - 4);
    }
    return phone;
  }

  private maskName(name: string): string {
    if (name.length > 1) {
      return name.charAt(0) + '***';
    }
    return name;
  }

  private countFields(obj: any): number {
    if (!obj || typeof obj !== 'object') {
      return 0;
    }

    let count = 0;
    
    if (Array.isArray(obj)) {
      for (const item of obj) {
        count += this.countFields(item);
      }
    } else {
      for (const value of Object.values(obj)) {
        count += 1;
        if (value && typeof value === 'object') {
          count += this.countFields(value);
        }
      }
    }

    return count;
  }
}