import mongoose from 'mongoose';
import env from '../config/env.js';
import pino from 'pino';

const logger = pino({ name: 'mongodb' });

let connected = false;

// Connect to the product-data store. Accepts a MongoDB Atlas URI or a
// self-hosted mongodb:// URI via MONGODB_URI — both are handled identically.
export async function connectDb() {
  if (connected) return mongoose.connection;
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  connected = true;
  logger.info('MongoDB connected');
  return mongoose.connection;
}

export async function closeDb() {
  if (connected) {
    await mongoose.connection.close();
    connected = false;
    logger.info('MongoDB disconnected');
  }
}

export async function testDbConnection() {
  try {
    if (mongoose.connection.readyState === 1) return true;
    await connectDb();
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'MongoDB connection failed');
    return false;
  }
}

export { mongoose };
