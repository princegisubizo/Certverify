import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import config from './config/env.js';
import { dbReady } from './config/db.js';
import authRoutes from './routes/auth.js';
import certificateRoutes from './routes/certificates.js';
import verifyRoutes from './routes/verify.js';
import { apiLimiter, originCheck } from './middleware/security.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();
  if (config.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(config.TRUST_PROXY) ? Number(config.TRUST_PROXY) : config.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The SPA bundle is same-origin; PDFs are embedded via iframe from /api/verify/*/pdf
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          frameSrc: ["'self'", ...(config.API_BASE_URL ? [config.API_BASE_URL] : [])],
          connectSrc: ["'self'", ...(config.API_BASE_URL ? [config.API_BASE_URL] : [])],
          objectSrc: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    })
  );

  const allowedOrigins = [config.CLIENT_URL, config.PUBLIC_APP_URL];
  app.use(cors({ origin: allowedOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(originCheck(allowedOrigins));

  app.get('/api/health', (req, res) => {
    res.status(dbReady() ? 200 : 503).json({ ok: dbReady() });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/certificates', certificateRoutes);
  app.use('/api/verify', verifyRoutes);
  app.use('/api', notFound);

  // Serve the built React app from the same origin so /verify/:id works on refresh and
  // QR codes never depend on a second domain.
  const dist = path.resolve(config.serverRoot, '..', 'client', 'dist');
  if (config.SERVE_CLIENT && fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Express 5 wildcard syntax. Any non-API GET returns the SPA so /verify/:id works on refresh.
    app.get('/{*splat}', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
