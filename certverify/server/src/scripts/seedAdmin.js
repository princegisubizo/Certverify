// Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... [ADMIN_NAME=...] npm run seed-admin
// There is deliberately no public registration endpoint; admins are created here.
import bcrypt from 'bcryptjs';
import config, { validateConfig } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import Admin from '../models/Admin.js';

validateConfig();
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const name = process.env.ADMIN_NAME || 'Administrator';

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Set ADMIN_EMAIL to a valid email address.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

await connectDb(config.MONGO_URI);
const passwordHash = await bcrypt.hash(password, 12);
const existing = await Admin.findOne({ email });
if (existing) {
  existing.passwordHash = passwordHash;
  existing.name = name;
  existing.active = true;
  existing.failedLogins = 0;
  existing.lockedUntil = null;
  await existing.save();
  console.log(`Updated password for admin ${email}`);
} else {
  await Admin.create({ email, name, passwordHash });
  console.log(`Created admin ${email}`);
}
await disconnectDb();
