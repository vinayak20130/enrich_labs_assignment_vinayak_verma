import { DataCleaner } from '../src/utils/DataCleaner';

describe('DataCleaner', () => {
  let dataCleaner: DataCleaner;

  beforeEach(() => {
    dataCleaner = new DataCleaner();
  });

  describe('PII Removal', () => {
    test('should remove SSN fields', () => {
      const input = {
        firstName: 'John',
        lastName: 'Johnson', // Using 'Johnson' so it starts with 'J'
        ssn: '123-45-6789',
        email: 'john@example.com'
      };

      const result = dataCleaner.clean(input);

      expect(result.ssn).toBeUndefined();
      expect(result.lastName).toBe('J***'); // lastName gets masked
      expect(result.email).toBe('joh***@example.com');
      expect(result.firstName).toBe('J***'); // firstName contains 'name' so gets masked
    });

    test('should remove credit card fields', () => {
      const input = {
        customerName: 'Jane',
        creditCard: '4111-1111-1111-1111',
        amount: 100
      };

      const result = dataCleaner.clean(input);

      expect(result.creditCard).toBeUndefined();
      expect(result.amount).toBe(100);
      expect(result.customerName).toBe('J***'); // Contains 'name' so gets masked
    });
  });

  describe('Field Masking', () => {
    test('should mask email addresses', () => {
      const input = {
        email: 'john.doe@example.com'
      };

      const result = dataCleaner.clean(input);

      expect(result.email).toBe('joh***@example.com');
    });

    test('should mask phone numbers', () => {
      const input = {
        phone: '555-123-4567'
      };

      const result = dataCleaner.clean(input);

      expect(result.phone).toBe('555***4567');
    });

    test('should mask name fields', () => {
      const input = {
        lastName: 'Johnson',
        firstName: 'Jane'
      };

      const result = dataCleaner.clean(input);

      expect(result.lastName).toBe('J***');
      expect(result.firstName).toBe('J***');
    });
  });

  describe('Nested Objects', () => {
    test('should clean nested objects recursively', () => {
      const input = {
        user: {
          firstName: 'John',
          ssn: '123-45-6789',
          contact: {
            email: 'john@test.com',
            phone: '555-1234'
          }
        },
        metadata: {
          creditCard: '4111-1111-1111-1111'
        }
      };

      const result = dataCleaner.clean(input);

      expect(result.user.ssn).toBeUndefined();
      expect(result.metadata.creditCard).toBeUndefined();
      expect(result.user.contact.email).toBe('joh***@test.com');
      expect(result.user.firstName).toBe('J***');
    });
  });

  describe('Arrays', () => {
    test('should clean arrays of objects', () => {
      const input = {
        users: [
          { firstName: 'John', ssn: '123-45-6789' },
          { firstName: 'Jane', email: 'jane@example.com' }
        ]
      };

      const result = dataCleaner.clean(input);

      expect(result.users[0].ssn).toBeUndefined();
      expect(result.users[0].firstName).toBe('J***');
      expect(result.users[1].email).toBe('jan***@example.com');
      expect(result.users[1].firstName).toBe('J***');
    });
  });

  describe('Non-sensitive Fields', () => {
    test('should not mask non-sensitive fields', () => {
      const input = {
        title: 'Manager',
        company: 'TechCorp',
        id: 12345,
        active: true
      };

      const result = dataCleaner.clean(input);

      expect(result.title).toBe('Manager');
      expect(result.company).toBe('TechCorp');
      expect(result.id).toBe(12345);
      expect(result.active).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle null and undefined values', () => {
      const input = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        number: 123
      };

      const result = dataCleaner.clean(input);

      expect(result.nullValue).toBeNull();
      expect(result.undefinedValue).toBeUndefined();
      expect(result.emptyString).toBe('');
      expect(result.number).toBe(123);
    });

    test('should handle non-object inputs', () => {
      expect(dataCleaner.clean('string')).toBe('string');
      expect(dataCleaner.clean(123)).toBe(123);
      expect(dataCleaner.clean(null)).toBeNull();
      expect(dataCleaner.clean(undefined)).toBeUndefined();
    });
  });
});
