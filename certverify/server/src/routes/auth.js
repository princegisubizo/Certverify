import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import Admin from '../models/Admin.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import { COOKIE_NAME, cookieOptions, requireAdmin, signToken } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/security.js';
import { audit } from '../services/audit.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  password: z.string().min(1, 'Password is required.').max(200),
});

// Compared against when the email is unknown so response time doesn't reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const publicAdmin = (a) => ({ id: String(a._id), email: a.email, name: a.name, role: a.role });

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const admin = await Admin.findOne({ email }).select('+passwordHash');
    const generic = new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

    if (!admin || !admin.active) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw generic;
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
    }
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      admin.failedLogins += 1;
      if (admin.failedLogins >= MAX_FAILS) {
        admin.lockedUntil = new Date(Date.now() + LOCK_MS);
        admin.failedLogins = 0;
      }
      await admin.save();
      throw generic;
    }
    admin.failedLogins = 0;
    admin.lockedUntil = null;
    admin.lastLoginAt = new Date();
    await admin.save();

    const token = signToken(admin);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    req.admin = admin;
    await audit(req, 'auth.login');
    res.json({ admin: publicAdmin(admin), token });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  })
);

router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: publicAdmin(req.admin) });
});

export default router;
