import { VendorManager } from '../src/vendors/VendorManager';
import { Configuration } from '../src/services/Configuration';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('VendorManager', () => {
  let vendorManager: VendorManager;
  let mockConfig: Configuration;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock configuration
    mockConfig = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          'SYNC_VENDOR_URL': 'http://localhost:3001/api/data',
          'ASYNC_VENDOR_URL': 'http://localhost:3002/api/data',
          'API_BASE_URL': 'http://localhost:3000'
        };
        return config[key];
      }),
      getNumber: jest.fn(),
      getBoolean: jest.fn(),
      getSyncVendorUrl: jest.fn(() => 'http://localhost:3001/api/data'),
      getAsyncVendorUrl: jest.fn(() => 'http://localhost:3002/api/data'),
      getApiBaseUrl: jest.fn(() => 'http://localhost:3000')
    } as any;
    
    vendorManager = new VendorManager(mockConfig);
  });

  describe('Initialization', () => {
    test('should initialize with vendor configurations', () => {
      const vendors = vendorManager.getAllVendors();
      
      expect(vendors).toBeDefined();
      expect(Array.isArray(vendors)).toBe(true);
      expect(vendors.length).toBeGreaterThan(0);
      
      // Should have the actual mock vendor names
      const vendorNames = vendors.map(v => v.name);
      expect(vendorNames).toContain('syncVendor');
      expect(vendorNames).toContain('asyncVendor');
    });
  });

  describe('Vendor Information', () => {
    test('should return vendor info for existing vendor', () => {
      const vendorInfo = vendorManager.getVendorInfo('syncVendor');
      
      expect(vendorInfo).toBeDefined();
      expect(vendorInfo?.name).toBe('syncVendor');
      expect(vendorInfo?.url).toBeDefined();
      expect(vendorInfo?.timeout).toBeGreaterThan(0);
    });

    test('should return undefined for non-existent vendor', () => {
      const vendorInfo = vendorManager.getVendorInfo('non-existent-vendor');
      
      expect(vendorInfo).toBeUndefined();
    });

    test('should return all vendors', () => {
      const allVendors = vendorManager.getAllVendors();
      
      expect(allVendors).toBeDefined();
      expect(allVendors.length).toBeGreaterThan(0);
      
      // Each vendor should have required properties
      allVendors.forEach(vendor => {
        expect(vendor.name).toBeDefined();
        expect(vendor.url).toBeDefined();
        expect(vendor.timeout).toBeGreaterThan(0);
        expect(vendor.rateLimit).toBeGreaterThan(0);
        expect(typeof vendor.isAsync).toBe('boolean');
      });
    });
  });

  describe('Synchronous Vendor Calls', () => {
    test('should call synchronous vendor successfully', async () => {
      const mockResponse = {
        data: { result: 'success', requestId: 'test-request-123' },
        status: 200
      };
      
      mockedAxios.post.mockResolvedValue(mockResponse);
      
      const result = await vendorManager.callVendor('syncVendor', { key: 'value' }, 'test-request-123');
      
      expect(result).toEqual({
        data: { result: 'success', requestId: 'test-request-123' },
        isAsync: false,
        status: 'success'
      });
    });

    test('should handle synchronous vendor errors', async () => {
      const mockError = new Error('Vendor service unavailable');
      mockedAxios.post.mockRejectedValue(mockError);
      
      const result = await vendorManager.callVendor('syncVendor', { key: 'value' }, 'test-request-123');
      
      expect(result.status).toBe('error');
      expect(result.error).toBe('Vendor service unavailable');
      expect(result.isAsync).toBe(false);
    });
  });

  describe('Asynchronous Vendor Calls', () => {
    test('should call asynchronous vendor successfully', async () => {
      const mockResponse = {
        data: { accepted: true, requestId: 'test-request-123' },
        status: 202
      };
      
      mockedAxios.post.mockResolvedValue(mockResponse);
      
      const result = await vendorManager.callVendor('asyncVendor', { key: 'value' }, 'test-request-123');
      
      expect(result.status).toBe('success');
      expect(result.data).toEqual({ accepted: true, requestId: 'test-request-123' });
      expect(result.isAsync).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle unknown vendor', async () => {
      try {
        await vendorManager.callVendor('unknown-vendor', { key: 'value' }, 'test-request-123');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Unknown vendor: unknown-vendor');
      }
    });
  });
});
