import rateLimit from 'express-rate-limit';
import config from '../config/env.js';
import { AppError } from '../utils/errors.js';

const limitHandler = (message) => (req, res, next) =>
  next(new AppError(429, 'RATE_LIMITED', message));

const base = { standardHeaders: true, legacyHeaders: false };

export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 10,
  handler: limitHandler('Too many login attempts. Please try again in 15 minutes.'),
});

export const verifyLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: config.isTest ? 10000 : 60,
  handler: limitHandler('Too many requests. Please slow down and try again shortly.'),
});

export const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: config.isTest ? 10000 : 300,
  handler: limitHandler('Too many requests. Please try again shortly.'),
});

/**
 * Defence in depth for cookie auth: for state-changing requests, if the browser sends an
 * Origin header it must be one we trust.
 */
export function originCheck(allowedOrigins) {
  const allowed = new Set(allowedOrigins.filter(Boolean));
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next(); // non-browser clients (curl, tests) – still need auth
    const sameHost = origin === `${req.protocol}://${req.get('host')}`;
    if (sameHost || allowed.has(origin)) return next();
    return next(new AppError(403, 'BAD_ORIGIN', 'Request origin is not allowed.'));
  };
}
