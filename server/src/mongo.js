const mongoose = require('mongoose');

async function connectMongoDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/scene-editor';
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    throw err;
  }
}

module.exports = { connectMongoDB };
