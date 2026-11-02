import dotenv from 'dotenv';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..', '..');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function trimSlash(url) {
  return (url || '').replace(/\/+$/, '');
}

function isPrivateIPv4(host) {
  const [a, b] = host.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isLocalUrl(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (
      ['localhost', '0.0.0.0', '::', '::1'].includes(host) ||
      host.endsWith('.localhost') ||
      host.endsWith('.local')
    ) return true;

    if (net.isIP(host) === 4) {
      return isPrivateIPv4(host);
    }

    if (net.isIP(host) === 6) {
      if (host.startsWith('::ffff:')) {
        const mappedIpv4 = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        const dottedIpv4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
        if (dottedIpv4) return isPrivateIPv4(dottedIpv4);
        if (mappedIpv4) {
          const high = Number.parseInt(mappedIpv4[1], 16);
          const low = Number.parseInt(mappedIpv4[2], 16);
          return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
        }
      }
      return host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host);
    }
    return false;
  } catch {
    return true;
  }
}

const config = {
  NODE_ENV,
  isProd,
  isTest,
  PORT: Number(process.env.PORT || 4000),
  MONGO_URI: process.env.MONGO_URI || '',
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || 'lax',

  // Where the React app is served (used for CORS + frame-ancestors).
  CLIENT_URL: trimSlash(process.env.CLIENT_URL || 'http://localhost:5173'),
  // Base of the PERMANENT public verification URL encoded into QR codes.
  PUBLIC_APP_URL: trimSlash(process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || 'http://localhost:5173'),
  API_BASE_URL: trimSlash(process.env.API_BASE_URL || ''),
  SERVE_CLIENT: (process.env.SERVE_CLIENT || 'true') !== 'false',

  INSTITUTION_NAME: process.env.INSTITUTION_NAME || 'Your Institution',
  MAX_UPLOAD_MB: Number(process.env.MAX_UPLOAD_MB || 10),
  ALLOW_PUBLIC_DOWNLOAD: (process.env.ALLOW_PUBLIC_DOWNLOAD || 'true') !== 'false',
  ALLOW_PUBLIC_PDF_WHEN_REVOKED: (process.env.ALLOW_PUBLIC_PDF_WHEN_REVOKED || 'true') !== 'false',
  QR_ERROR_CORRECTION: (process.env.QR_ERROR_CORRECTION || 'Q').toUpperCase(),
  PDF_QR_PAGE: Number(process.env.PDF_QR_PAGE || 1),
  PDF_QR_SIZE_MM: Number(process.env.PDF_QR_SIZE_MM || 28),
  PDF_QR_MARGIN_MM: Number(process.env.PDF_QR_MARGIN_MM || 10),
  PDF_QR_CORNER: (process.env.PDF_QR_CORNER || 'bottom-right').toLowerCase(),

  STORAGE_DRIVER: process.env.STORAGE_DRIVER || 'local', // local | s3
  LOCAL_STORAGE_DIR: path.resolve(serverRoot, process.env.LOCAL_STORAGE_DIR || 'storage'),
  S3_BUCKET: process.env.S3_BUCKET || '',
  S3_REGION: process.env.S3_REGION || 'us-east-1',
  S3_ENDPOINT: process.env.S3_ENDPOINT || '',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || '',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || '',

  TRUST_PROXY: process.env.TRUST_PROXY || (isProd ? '1' : ''),
  serverRoot,
};

export function validateConfig() {
  const problems = [];
  if (!isTest) {
    if (!config.MONGO_URI) problems.push('MONGO_URI is required');
    if (!config.JWT_SECRET || config.JWT_SECRET.length < 32) {
      problems.push('JWT_SECRET is required and must be at least 32 characters');
    }
  }
  if (isProd) {
    if (!process.env.PUBLIC_APP_URL) problems.push('PUBLIC_APP_URL must be explicitly configured in production');
    if (!config.PUBLIC_APP_URL.startsWith('https://')) problems.push('PUBLIC_APP_URL must be https:// in production');
    if (isLocalUrl(config.PUBLIC_APP_URL)) problems.push('PUBLIC_APP_URL must not point to localhost in production (QR codes would be broken)');
    try {
      const publicUrl = new URL(config.PUBLIC_APP_URL);
      if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') {
        problems.push('PUBLIC_APP_URL must be an origin without credentials, a path, query string or fragment');
      }
    } catch {
      problems.push('PUBLIC_APP_URL must be a valid absolute URL');
    }
    if (!config.CLIENT_URL.startsWith('https://')) problems.push('CLIENT_URL must be https:// in production');
    if (config.STORAGE_DRIVER === 'local') {
      console.warn('[warn] STORAGE_DRIVER=local in production: make sure the directory is on a persistent, backed-up volume.');
    }
  }
  if (config.STORAGE_DRIVER === 's3') {
    if (!config.S3_BUCKET) problems.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
  }
  if (!['L', 'M', 'Q', 'H'].includes(config.QR_ERROR_CORRECTION)) problems.push('QR_ERROR_CORRECTION must be L, M, Q or H');
  if (!Number.isInteger(config.PDF_QR_PAGE) || config.PDF_QR_PAGE < 1) problems.push('PDF_QR_PAGE must be a positive integer');
  if (!Number.isFinite(config.PDF_QR_SIZE_MM) || config.PDF_QR_SIZE_MM <= 0) problems.push('PDF_QR_SIZE_MM must be greater than 0');
  if (!Number.isFinite(config.PDF_QR_MARGIN_MM) || config.PDF_QR_MARGIN_MM < 0) problems.push('PDF_QR_MARGIN_MM must be 0 or greater');
  if (!['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(config.PDF_QR_CORNER)) {
    problems.push('PDF_QR_CORNER must be bottom-right, bottom-left, top-right or top-left');
  }
  if (problems.length) {
    throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));
  }
}

export default config;
