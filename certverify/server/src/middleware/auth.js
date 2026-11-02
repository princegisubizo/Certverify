import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import Admin from '../models/Admin.js';
import { AppError, asyncHandler } from '../utils/errors.js';

export const COOKIE_NAME = 'cv_token';

export function signToken(admin) {
  return jwt.sign({ sub: String(admin._id), role: admin.role }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.COOKIE_SAMESITE,
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  };
}

function extractToken(req) {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const h = req.get('authorization');
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/** Requires a valid admin session on every protected route. */
export const requireAdmin = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session is invalid or has expired. Please sign in again.');
  }
  const admin = await Admin.findById(payload.sub);
  if (!admin || !admin.active || admin.role !== 'admin') {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session is invalid or has expired. Please sign in again.');
  }
  req.admin = admin;
  next();
});
