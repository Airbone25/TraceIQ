import mongoose from 'mongoose';
import env from './env.js';

let connected = false;

export async function connectDb() {
  if (connected) return mongoose.connection;
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  connected = true;
  return mongoose.connection;
}

export async function closeDb() {
  if (connected) {
    await mongoose.connection.close();
    connected = false;
  }
}

export { mongoose };
