// Database-independent unit tests (run anywhere, no MongoDB needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

process.env.NODE_ENV = 'test';
process.env.PUBLIC_APP_URL = 'https://certs.example.test';
process.env.CLIENT_URL = 'https://certs.example.test';

const jsQR = (await import('jsqr')).default;
const { PNG } = await import('pngjs');
const { PDFDocument, PDFName, degrees } = await import('pdf-lib');
const { validatePdfBuffer, sha256, safeFilename } = await import('../src/services/pdf.js');
const { embedQrInPdf, findQrPosition } = await import('../src/services/pdfEmbed.js');
const {
  generateCertificateId,
  generateVerificationToken,
  isValidCertificateId,
  normalizeCertificateNumber,
} = await import('../src/utils/ids.js');
const { qrPng, qrSvg, verificationUrl } = await import('../src/services/qr.js');
const { LocalDriver } = await import('../src/services/storage.js');

const goodPdf = Buffer.from(`%PDF-1.4\n${'1 0 obj<<>>endobj\n'.repeat(5)}trailer<<>>\n%%EOF\n`, 'latin1');

test('PDF validation inspects content, not names', () => {
  assert.ok(validatePdfBuffer(goodPdf));
  assert.throws(() => validatePdfBuffer(Buffer.from('<html>'.repeat(30))), /not a valid PDF/);
  assert.throws(() => validatePdfBuffer(Buffer.from('%PDF-1.4 '.padEnd(200, 'x'))), /truncated/);
  assert.throws(() => validatePdfBuffer(Buffer.alloc(0)), /empty/);
});

test('checksum and filename helpers', () => {
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(safeFilename('../../etc/passwd'), '.._.._etc_passwd.pdf');
  assert.equal(safeFilename('My Cert.pdf'), 'My Cert.pdf');
});

test('certificate IDs are random, well-formed and valid', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => generateCertificateId()));
  assert.equal(ids.size, 2000);
  for (const id of ids) {
    assert.match(id, /^CERT-\d{4}-[A-HJ-NP-Z2-9]{8}$/);
    assert.ok(isValidCertificateId(id));
  }
  assert.equal(normalizeCertificateNumber(' kit 2026/1 '), 'KIT-2026/1');
  assert.equal(isValidCertificateId('KIT-2026/1'), false);
  assert.equal(isValidCertificateId('../x'), false);
  assert.equal(isValidCertificateId('AB'), false);
});

test('public verification tokens are stable-format, URL-safe and high entropy', () => {
  const tokens = new Set(Array.from({ length: 1000 }, () => generateVerificationToken()));
  assert.equal(tokens.size, 1000);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test('QR code PNG decodes to the permanent verification URL (round trip)', async () => {
  const id = 'CERT-2026-K7M2QX9P';
  const png = PNG.sync.read(await qrPng(id));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded?.data, `https://certs.example.test/verify/${id}`);
  assert.equal(decoded.data, verificationUrl(id));
  assert.match(await qrSvg(id), /^<svg|<\?xml/);
});

test('QR embedding preserves the original and places a readable image in a clear corner area', async () => {
  const sourceDocument = await PDFDocument.create();
  const first = sourceDocument.addPage([600, 800]);
  first.drawText('Original certificate content');
  const second = sourceDocument.addPage([800, 600]);
  second.setRotation(degrees(90));
  const original = Buffer.from(await sourceDocument.save());
  const originalHash = sha256(original);

  const result = await embedQrInPdf(original, await qrPng('CERT-2026-K7M2QX9P'));
  const finalDocument = await PDFDocument.load(result);
  assert.equal(sha256(original), originalHash, 'embedding must not mutate the original upload');
  assert.equal(finalDocument.getPageCount(), 2);
  assert.deepEqual(finalDocument.getPages().map((page) => page.getSize()), [
    { width: 600, height: 800 },
    { width: 800, height: 600 },
  ]);
  const [finalFirst, finalSecond] = finalDocument.getPages();
  assert.ok(finalFirst.node.Resources().lookup(PDFName.of('XObject')), 'the QR image is embedded on the first page');
  assert.equal(finalSecond.node.Resources()?.lookup(PDFName.of('XObject')), undefined, 'other pages remain unchanged');
  assert.match(result.toString('latin1'), /\/Subtype\s*\/Image/);

  const { createCanvas } = await import('@napi-rs/canvas');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({ data: new Uint8Array(result), useSystemFonts: true });
  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    assert.equal(decoded?.data, 'https://certs.example.test/verify/CERT-2026-K7M2QX9P');
    canvas.width = 0;
    canvas.height = 0;
  } finally {
    await loadingTask.destroy();
  }

  const firstPosition = await findQrPosition(original, 1, { sizeMm: 28, marginMm: 10 });
  assert.ok(firstPosition.sizeMm >= 18 && firstPosition.sizeMm <= 28);
  assert.ok(firstPosition.x > 600 * 0.7);
  assert.ok(firstPosition.y < 800 * 0.3);
  const rotatedPosition = await findQrPosition(original, 2, { sizeMm: 28, marginMm: 10 });
  assert.ok(rotatedPosition.sizeMm >= 18 && rotatedPosition.sizeMm <= 28);
  const alternateCorner = await findQrPosition(original, 1, {
    sizeMm: 28,
    marginMm: 10,
    corner: 'bottom-left',
  });
  assert.ok(alternateCorner.x < 600 * 0.3);
});

test('QR embedding rejects invalid PDFs and pages without a sufficiently clear corner', async () => {
  const qr = await qrPng('CERT-2026-K7M2QX9P');
  await assert.rejects(() => embedQrInPdf(Buffer.from('%PDF-1.4 invalid %%EOF'), qr), { code: 'INVALID_PDF' });
  const signed = Buffer.from(`%PDF-1.4\n/ByteRange [0 1 2 3]\n${'x'.repeat(60)}\n%%EOF\n`);
  await assert.rejects(() => embedQrInPdf(signed, qr), { code: 'DIGITALLY_SIGNED_PDF_UNSUPPORTED' });

  const document = await PDFDocument.create();
  document.addPage([70, 70]);
  const tooSmall = Buffer.from(await document.save());
  await assert.rejects(() => embedQrInPdf(tooSmall, qr), { code: 'PDF_QR_SPACE_NOT_FOUND' });
});

test('production refuses an unconfigured or private verification URL', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-config-'));
  const envModule = new URL('../src/config/env.js', import.meta.url).href;
  const script = `import { validateConfig } from ${JSON.stringify(envModule)}; try { validateConfig(); } catch (error) { console.log(error.message); process.exitCode = 1; }`;
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'production',
    MONGO_URI: 'mongodb://127.0.0.1:27017/certverify',
    JWT_SECRET: 'test-secret-with-more-than-thirty-two-characters',
    CLIENT_URL: 'https://certs.example.test',
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'test-bucket',
  };
  delete baseEnv.PUBLIC_APP_URL;
  delete baseEnv.DOTENV_CONFIG_PATH;

  try {
    const missing = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd,
      env: baseEnv,
      encoding: 'utf8',
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stdout, /PUBLIC_APP_URL must be explicitly configured/);

    const privateUrl = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd,
      env: { ...baseEnv, PUBLIC_APP_URL: 'https://192.168.1.40' },
      encoding: 'utf8',
    });
    assert.notEqual(privateUrl.status, 0);
    assert.match(privateUrl.stdout, /must not point to localhost/);

    const mappedPrivateUrl = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd,
      env: { ...baseEnv, PUBLIC_APP_URL: 'https://[::ffff:192.168.1.40]' },
      encoding: 'utf8',
    });
    assert.notEqual(mappedPrivateUrl.status, 0);
    assert.match(mappedPrivateUrl.stdout, /must not point to localhost/);

    const validUrl = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd,
      env: { ...baseEnv, PUBLIC_APP_URL: 'https://certs.example.test' },
      encoding: 'utf8',
    });
    assert.equal(validUrl.status, 0, validUrl.stderr);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('local storage blocks path traversal and round-trips bytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-store-'));
  const d = new LocalDriver(dir);
  await assert.rejects(() => d.put('../escape.pdf', goodPdf), /Unsafe/);
  await assert.rejects(() => d.getStream('/etc/passwd'), /Unsafe/);
  await d.put('certificates/2026/a.pdf', goodPdf);
  const { stream, size } = await d.getStream('certificates/2026/a.pdf');
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  assert.equal(size, goodPdf.length);
  assert.ok(Buffer.concat(chunks).equals(goodPdf));
  await d.remove('certificates/2026/a.pdf');
  await assert.rejects(() => d.getStream('certificates/2026/a.pdf'));
  fs.rmSync(dir, { recursive: true, force: true });
});
