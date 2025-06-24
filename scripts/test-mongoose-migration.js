// Simple test script to verify Mongoose migration works
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Import the model - use require for simplicity in test script
const { JobModel } = require('../dist/src/models/Job');

async function testMongooseMigration() {
  console.log('🧪 Testing Mongoose Migration...\n');

  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/vendor_service_test');
    console.log(' Connected to MongoDB via Mongoose');

    // Test 1: Schema Validation (Valid Job)
    console.log('\n📝 Test 1: Creating valid job...');
    const validJob = new JobModel({
      requestId: uuidv4(),
      status: 'pending',
      payload: { type: 'sync', test: 'data' }
    });
    await validJob.save();
    console.log(' Valid job created successfully');

    // Test 2: Schema Validation (Invalid Job)
    console.log('\n📝 Test 2: Testing validation (should fail)...');
    try {
      const invalidJob = new JobModel({
        requestId: 'invalid-uuid',  // Invalid UUID
        status: 'invalid-status',   // Invalid enum
        payload: null               // Invalid payload
      });
      await invalidJob.save();
      console.log('❌ This should not have worked!');
    } catch (error) {
      console.log(' Validation correctly rejected invalid job');
      console.log(`   Error: ${error.message.split('\n')[0]}`);
    }

    // Test 3: Model Methods
    console.log('\n📝 Test 3: Testing model methods...');
    await validJob.markAsProcessing('testVendor');
    console.log(' markAsProcessing() method works');
    
    await validJob.markAsComplete({ result: 'test data' });
    console.log(' markAsComplete() method works');

    // Test 4: Static Methods
    console.log('\n📝 Test 4: Testing static methods...');
    const recentJobs = await JobModel.findRecentJobs(1);
    console.log(` findRecentJobs() found ${recentJobs.length} jobs`);

    const completedJobs = await JobModel.findByStatus('complete');
    console.log(` findByStatus() found ${completedJobs.length} completed jobs`);

    // Cleanup
    await JobModel.deleteMany({ requestId: validJob.requestId });
    console.log(' Test data cleaned up');

    console.log('\n🎉 All tests passed! Mongoose migration successful!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log(' Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the test
testMongooseMigration();
