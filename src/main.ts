import { ApplicationContainer } from './container/DIContainer';
import { VendorDataFetchServer } from './server';

// Main entry point - this is where everything starts
async function startApplication(): Promise<void> {
  const container = new ApplicationContainer();
  
  try {
    // Wire up all the dependencies - MongoDB, Redis, services, etc.
    await container.initialize();
    
    // Start the HTTP server with all dependencies injected
    const server = new VendorDataFetchServer(container);
    await server.start();
    
    // Handle Docker/Kubernetes shutdown signals properly
    // This ensures we don't lose jobs when containers restart
    const shutdown = async () => {
      console.log('Received shutdown signal, gracefully shutting down...');
      await server.shutdown();  // Close connections, finish processing
      process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);  // Docker stop
    process.on('SIGINT', shutdown);   // Ctrl+C
    
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);  // Let the process manager restart us
  }
}

// Start the application
startApplication();
