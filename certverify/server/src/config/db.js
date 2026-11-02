import mongoose from 'mongoose';
import config from './env.js';

export async function connectDb(uri = config.MONGO_URI) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  // Make sure unique indexes exist before serving traffic.
  await mongoose.syncIndexes();
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function dbReady() {
  return mongoose.connection.readyState === 1;
}
