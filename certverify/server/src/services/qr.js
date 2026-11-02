import QRCode from 'qrcode';
import config from '../config/env.js';

export function verificationUrl(verificationToken) {
  return `${config.PUBLIC_APP_URL}/verify/${encodeURIComponent(verificationToken)}`;
}

function assertNotLocalInProduction(url) {
  if (config.isProd && /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url)) {
    throw new Error('Refusing to generate a QR code that points to localhost in production.');
  }
}

// Quiet zone of 4 modules is the QR spec minimum; error correction Q (25%) by default
// tolerates print blemishes while keeping the code small enough to print at ~2.5 cm.
const common = () => ({
  errorCorrectionLevel: config.QR_ERROR_CORRECTION,
  margin: 4,
  color: { dark: '#000000', light: '#FFFFFF' },
});

export async function qrPng(verificationToken, width = 1024) {
  const url = verificationUrl(verificationToken);
  assertNotLocalInProduction(url);
  return QRCode.toBuffer(url, { ...common(), type: 'png', width });
}

export async function qrSvg(verificationToken) {
  const url = verificationUrl(verificationToken);
  assertNotLocalInProduction(url);
  return QRCode.toString(url, { ...common(), type: 'svg' });
}
