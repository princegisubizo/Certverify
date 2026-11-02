import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// Configure environment BEFORE importing the app (config reads env at import time).
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'certverify-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.MAX_UPLOAD_MB = '1';
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.PUBLIC_APP_URL = 'https://certs.example.test';
process.env.CLIENT_URL = 'https://certs.example.test';
process.env.SERVE_CLIENT = 'false';

// Use TEST_MONGO_URI (any disposable MongoDB) if provided; otherwise start an in-memory MongoDB.
// NOTE: the in-memory server downloads a mongod binary on first run, which needs internet access.
const TEST_MONGO_URI = process.env.TEST_MONGO_URI;
const MongoMemoryServer = TEST_MONGO_URI ? null : (await import('mongodb-memory-server')).MongoMemoryServer;
const supertest = (await import('supertest')).default;
const bcrypt = (await import('bcryptjs')).default;
const jsQR = (await import('jsqr')).default;
const { PNG } = await import('pngjs');
const { PDFDocument } = await import('pdf-lib');
const { connectDb, disconnectDb } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const Admin = (await import('../src/models/Admin.js')).default;
const Certificate = (await import('../src/models/Certificate.js')).default;
const { getStorage, setStorageDriver } = await import('../src/services/storage.js');

let mongod, agent, token;

// A tiny but structurally valid PDF with unique bytes per call.
function makePdf(marker = 'x') {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${marker} ${crypto.randomUUID()}\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const fields = (over = {}) => ({
  studentName: 'Amina Uwase',
  course: 'BSc Computer Science',
  institution: 'Kigali Institute of Technology',
  issueDate: '2026-06-30',
  ...over,
});

const verificationId = (cert) => new URL(cert.verificationUrl).pathname.split('/').pop();

function upload(pdf, f = fields(), filename = 'cert.pdf', auth = true) {
  let r = agent.post('/api/certificates');
  if (auth) r = r.set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(f)) r = r.field(k, v);
  if (pdf) r = r.attach('pdf', pdf, { filename, contentType: 'application/pdf' });
  return r;
}
const authed = (req) => req.set('Authorization', `Bearer ${token}`);

const dbUri = () => TEST_MONGO_URI || mongod.getUri('certtest');

before(async () => {
  if (!TEST_MONGO_URI) mongod = await MongoMemoryServer.create();
  await connectDb(dbUri());
  // Start from a clean slate when pointing at a shared test database.
  await Promise.all([Admin.deleteMany({}), Certificate.deleteMany({})]);
  await Admin.create({ email: 'admin@example.test', name: 'Admin', passwordHash: await bcrypt.hash('correct-horse-battery', 4) });
  agent = supertest(createApp());
  const res = await agent.post('/api/auth/login').send({ email: 'admin@example.test', password: 'correct-horse-battery' });
  token = res.body.token;
});

after(async () => {
  await disconnectDb();
  await mongod?.stop();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

/* 1-2 auth */
test('admin can log in with valid credentials', async () => {
  const res = await agent.post('/api/auth/login').send({ email: 'admin@example.test', password: 'correct-horse-battery' });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.match(res.headers['set-cookie'][0], /HttpOnly/i);
  const me = await agent.get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
  assert.equal(me.body.admin.email, 'admin@example.test');
});

test('invalid credentials are rejected with a generic message', async () => {
  const bad = await agent.post('/api/auth/login').send({ email: 'admin@example.test', password: 'wrong-password' });
  const unknown = await agent.post('/api/auth/login').send({ email: 'nobody@example.test', password: 'whatever12345' });
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(bad.body.error.message, unknown.body.error.message);
});

/* 3 */
test('unauthenticated users cannot create, edit, list or revoke certificates', async () => {
  const create = await upload(makePdf(), fields(), 'a.pdf', false);
  assert.equal(create.status, 401);
  assert.equal((await agent.patch('/api/certificates/CERT-X').send({ studentName: 'Hacker' })).status, 401);
  assert.equal((await agent.patch('/api/certificates/CERT-X/status').send({ status: 'revoked', reason: 'abc' })).status, 401);
  assert.equal((await agent.get('/api/certificates')).status, 401);
  assert.equal((await agent.delete('/api/certificates/CERT-X?confirm=true')).status, 401);
  assert.equal((await agent.get('/api/certificates/stats')).status, 401);
});

/* 15 */
test('public users cannot browse all certificates or reach admin PDF/QR endpoints', async () => {
  assert.equal((await agent.get('/api/verify')).status, 404);
  assert.equal((await agent.get('/api/certificates')).status, 401);
  assert.equal((await agent.get('/api/certificates/CERT-ANY/pdf')).status, 401);
  assert.equal((await agent.get('/api/certificates/CERT-ANY/original-pdf')).status, 401);
  assert.equal((await agent.get('/api/certificates/CERT-ANY/qr')).status, 401);
});

/* 4, 7, 9, 10, 11 – the core flow */
test('end-to-end: upload → QR-embedded printable PDF → public verification + preserved original', async () => {
  const pdf = makePdf('e2e');
  const res = await upload(pdf);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const cert = res.body.certificate;
  assert.match(cert.certificateId, /^CERT-\d{4}-[A-Z2-9]{8}$/);
  const publicId = verificationId(cert);
  assert.match(publicId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(cert.verificationUrl, `https://certs.example.test/verify/${publicId}`);
  assert.notEqual(publicId, cert.certificateId);
  assert.equal(cert.pdfChecksum, crypto.createHash('sha256').update(pdf).digest('hex'));
  assert.equal(cert.pdfContainsQr, true);
  assert.ok(cert.pdfFinalChecksum);
  assert.ok(cert.pdfFinalSize > cert.pdfSize);
  assert.equal(cert.pdfStorageKey, undefined, 'storage key must not leak');
  assert.equal(cert.pdfFinalStorageKey, undefined, 'final storage key must not leak');

  // 9: QR PNG decodes to the permanent verification URL
  const qr = await authed(agent.get(`/api/certificates/${cert.certificateId}/qr?format=png`)).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(qr.status, 200);
  assert.equal(qr.headers['content-type'], 'image/png');
  const png = PNG.sync.read(qr.body);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(decoded, 'QR code must be decodable');
  assert.equal(decoded.data, cert.verificationUrl);

  const svg = await authed(agent.get(`/api/certificates/${cert.certificateId}/qr?format=svg`));
  assert.match(svg.headers['content-type'], /svg/);

  // 10: public verification shows correct, minimal data
  const v = await agent.get(`/api/verify/${publicId}`);
  assert.equal(v.status, 200);
  assert.equal(v.body.status, 'valid');
  assert.equal(v.body.studentName, 'Amina Uwase');
  assert.equal(v.body.course, 'BSc Computer Science');
  assert.equal(v.body.institution, 'Kigali Institute of Technology');
  for (const leaked of ['pdfStorageKey', '_id', 'createdBy', 'notes', 'pdfChecksum']) assert.equal(v.body[leaked], undefined);
  assert.equal((await agent.get(`/api/verify/${cert.certificateId}`)).status, 404, 'new certificates cannot be enumerated by their certificate ID');

  // The public PDF is the printable QR-embedded copy; the exact original is admin-only.
  const pdfRes = await agent.get(`/api/verify/${publicId}/pdf`).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers['content-type'], 'application/pdf');
  assert.match(pdfRes.headers['content-disposition'], /^inline/);
  assert.ok(!pdfRes.body.equals(pdf), 'public PDF must include the embedded QR');
  const parsedFinal = await PDFDocument.load(pdfRes.body);
  assert.equal(parsedFinal.getPageCount(), 1);
  assert.match(pdfRes.body.toString('latin1'), /\/Subtype\s*\/Image/);

  const originalRes = await authed(agent.get(`/api/certificates/${cert.certificateId}/original-pdf?download=1`)).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(originalRes.status, 200);
  assert.match(originalRes.headers['content-disposition'], /^attachment/);
  assert.ok(originalRes.body.equals(pdf), 'the administrator can retrieve the unchanged original upload');

  const repeated = await agent.get(`/api/verify/${publicId}/pdf`).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.ok(repeated.body.equals(pdfRes.body), 'repeated PDF downloads must not add another QR code');

  const dl = await agent.get(`/api/verify/${publicId}/pdf?download=1`);
  assert.match(dl.headers['content-disposition'], /^attachment/);
});

test('PDF-looking but corrupt uploads are rejected before certificate registration', async () => {
  const corrupt = Buffer.from(`%PDF-1.4\n${'not a PDF object '.repeat(8)}\n%%EOF\n`, 'latin1');
  const result = await upload(corrupt, fields({ studentName: 'Corrupt PDF Upload' }));
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_PDF');
  assert.equal(await Certificate.exists({ studentName: 'Corrupt PDF Upload' }), null);
});

test('legacy records without a verification token remain verifiable by certificate ID', async () => {
  const result = await upload(makePdf(), fields({ studentName: 'Legacy Certificate' }));
  const id = result.body.certificate.certificateId;
  await Certificate.updateOne({ certificateId: id }, { $unset: { verificationToken: '' } });
  const verification = await agent.get(`/api/verify/${id}`);
  assert.equal(verification.status, 200);
  assert.equal(verification.body.certificateId, id);
});

test('storage and database failures clean up partial files and do not register a certificate', async () => {
  const originalStorage = getStorage();
  const storedKeys = [];
  const removedKeys = [];
  let puts = 0;
  setStorageDriver({
    async put(key) {
      puts += 1;
      storedKeys.push(key);
      if (puts === 2) throw new Error('simulated storage failure');
    },
    async remove(key) {
      removedKeys.push(key);
    },
  });

  try {
    const storageFailure = await upload(makePdf(), fields({ studentName: 'Storage Failure' }));
    assert.equal(storageFailure.status, 500);
    assert.equal(await Certificate.exists({ studentName: 'Storage Failure' }), null);
    assert.equal(removedKeys.length, 2, 'both the original and partial final object are cleaned up');

    setStorageDriver({
      async put(key) {
        storedKeys.push(key);
      },
      async remove(key) {
        removedKeys.push(key);
      },
    });
    const originalCreate = Certificate.create;
    Certificate.create = async () => {
      throw new Error('simulated database failure');
    };
    try {
      const databaseFailure = await upload(makePdf(), fields({ studentName: 'Database Failure' }));
      assert.equal(databaseFailure.status, 500);
      assert.equal(await Certificate.exists({ studentName: 'Database Failure' }), null);
      assert.equal(removedKeys.length, 4, 'both stored objects are cleaned up when record creation fails');
    } finally {
      Certificate.create = originalCreate;
    }
  } finally {
    setStorageDriver(originalStorage);
  }
});

/* 5 */
test('non-PDF content is rejected even with a .pdf name and PDF mime type', async () => {
  const fake = Buffer.from('MZ\x90\x00 this is definitely not a pdf '.repeat(5));
  const res = await upload(fake, fields({ studentName: 'Fake File' }), 'evil.pdf');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_FILE');
  const wrongExt = await upload(makePdf(), fields({ studentName: 'Wrong Ext' }), 'cert.png');
  assert.equal(wrongExt.status, 400);
  assert.equal(await Certificate.countDocuments({ studentName: /Fake File|Wrong Ext/ }), 0);
});

/* 6 */
test('oversized uploads are rejected', async () => {
  const big = Buffer.concat([makePdf(), Buffer.alloc(1.2 * 1024 * 1024, 'a'), Buffer.from('\n%%EOF\n')]);
  const res = await upload(big, fields({ studentName: 'Big File' }));
  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
});

test('required fields are validated with clear messages', async () => {
  const res = await upload(makePdf(), { studentName: '', course: '', institution: '', issueDate: 'nope' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(res.body.error.details.studentName);
  assert.ok(res.body.error.details.course);
  assert.ok(res.body.error.details.issueDate);
  const noFile = await upload(null);
  assert.equal(noFile.status, 400);
});

/* 7, 8 */
test('identifiers are unique; supplied certificate numbers are honoured and duplicates rejected', async () => {
  const a = await upload(makePdf(), fields({ studentName: 'Unique One', certificateNumber: 'kit/2026' }));
  assert.equal(a.status, 400, 'slashes not allowed in public IDs');

  const b = await upload(makePdf(), fields({ studentName: 'Unique Two', certificateNumber: 'kit-2026-0001' }));
  assert.equal(b.status, 201);
  assert.equal(b.body.certificate.certificateId, 'KIT-2026-0001');

  const dup = await upload(makePdf(), fields({ studentName: 'Someone Else', certificateNumber: 'KIT-2026-0001' }));
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'DUPLICATE_CERTIFICATE_NUMBER');

  const ids = new Set();
  for (let i = 0; i < 5; i++) {
    const r = await upload(makePdf(), fields({ studentName: `Generated ${i}` }));
    assert.equal(r.status, 201);
    ids.add(r.body.certificate.certificateId);
  }
  assert.equal(ids.size, 5);
});

test('same student + course + date is flagged as a likely duplicate unless confirmed', async () => {
  const f = fields({ studentName: 'Dup Detect' });
  assert.equal((await upload(makePdf(), f)).status, 201);
  const second = await upload(makePdf(), f);
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'DUPLICATE_RECORD');
  const forced = await upload(makePdf(), { ...f, confirmDuplicate: 'true' });
  assert.equal(forced.status, 201);
});

/* 12 */
test('revoked certificates are clearly marked revoked, and can be restored', async () => {
  const r = await upload(makePdf(), fields({ studentName: 'To Revoke' }));
  const { certificateId: id } = r.body.certificate;
  const publicId = verificationId(r.body.certificate);

  const noReason = await authed(agent.patch(`/api/certificates/${id}/status`)).send({ status: 'revoked' });
  assert.equal(noReason.status, 400);

  const rev = await authed(agent.patch(`/api/certificates/${id}/status`)).send({ status: 'revoked', reason: 'Issued in error' });
  assert.equal(rev.status, 200);
  const v = await agent.get(`/api/verify/${publicId}`);
  assert.equal(v.body.status, 'revoked');
  assert.ok(v.body.revokedAt);
  assert.equal(v.body.revocationReason, undefined, 'internal reason is not public');

  const back = await authed(agent.patch(`/api/certificates/${id}/status`)).send({ status: 'valid' });
  assert.equal(back.body.certificate.status, 'valid');
  assert.equal((await agent.get(`/api/verify/${publicId}`)).body.status, 'valid');

  const log = await authed(agent.get(`/api/certificates/${id}/audit`));
  const actions = log.body.items.map((i) => i.action);
  assert.ok(actions.includes('certificate.revoke') && actions.includes('certificate.restore') && actions.includes('certificate.create'));
});

/* 13 */
test('unknown certificate IDs return 404 CERTIFICATE_NOT_FOUND (never a success)', async () => {
  const res = await agent.get('/api/verify/CERT-2026-NOPE0000');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'CERTIFICATE_NOT_FOUND');
  assert.equal(res.body.status, undefined);
  assert.equal((await agent.get('/api/verify/CERT-2026-NOPE0000/pdf')).status, 404);
  assert.equal((await agent.get('/api/verify/%24ne')).status, 404);
});

/* editing + replacing the PDF keeps the URL */
test('admin can regenerate a printable PDF from the preserved original without creating another record', async () => {
  const uploaded = await upload(makePdf('regenerate'), fields({ studentName: 'Regenerate Me' }));
  const before = uploaded.body.certificate;
  const id = before.certificateId;
  const publicId = verificationId(before);
  const countBefore = await Certificate.countDocuments({ certificateId: id });

  const regenerated = await authed(agent.post(`/api/certificates/${id}/pdf/regenerate`));
  assert.equal(regenerated.status, 200);
  assert.equal(regenerated.body.certificate.certificateId, id);
  assert.equal(regenerated.body.certificate.verificationUrl, before.verificationUrl);
  assert.equal(regenerated.body.certificate.pdfChecksum, before.pdfChecksum);
  assert.equal(regenerated.body.certificate.pdfContainsQr, true);
  assert.ok(regenerated.body.certificate.pdfFinalChecksum);
  assert.equal(await Certificate.countDocuments({ certificateId: id }), countBefore);
  assert.equal((await agent.get(`/api/verify/${publicId}`)).body.status, 'valid');

  const preservedOriginal = await authed(agent.get(`/api/certificates/${id}/original-pdf`)).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(crypto.createHash('sha256').update(preservedOriginal.body).digest('hex'), before.pdfChecksum);

  const printable = await authed(agent.get(`/api/certificates/${id}/pdf`));
  assert.equal(printable.status, 200);
  assert.equal(printable.headers.etag, `"${regenerated.body.certificate.pdfFinalChecksum}"`);

  const log = await authed(agent.get(`/api/certificates/${id}/audit`));
  assert.ok(log.body.items.some((item) => item.action === 'certificate.regenerate_pdf'));
});

test('admin can edit metadata and replace the PDF while keeping the same verification URL', async () => {
  const original = makePdf('original');
  const r = await upload(original, fields({ studentName: 'Replace Me' }));
  const id = r.body.certificate.certificateId;
  const publicId = verificationId(r.body.certificate);

  const edit = await authed(agent.patch(`/api/certificates/${id}`)).send({ studentName: 'Replaced Name', course: 'MSc Data Science' });
  assert.equal(edit.body.certificate.studentName, 'Replaced Name');
  const immutable = await authed(agent.patch(`/api/certificates/${id}`)).send({ certificateId: 'HACKED-ID' });
  assert.equal(immutable.status, 400);

  const replacement = makePdf('replacement');
  const noConfirm = await authed(agent.post(`/api/certificates/${id}/pdf`)).attach('pdf', replacement, { filename: 'new.pdf', contentType: 'application/pdf' });
  assert.equal(noConfirm.status, 400);

  const rep = await authed(agent.post(`/api/certificates/${id}/pdf`)).field('confirm', 'true').attach('pdf', replacement, { filename: 'new.pdf', contentType: 'application/pdf' });
  assert.equal(rep.status, 200);
  assert.equal(rep.body.certificate.certificateId, id);
  assert.notEqual(rep.body.certificate.pdfChecksum, r.body.certificate.pdfChecksum);

  const served = await agent.get(`/api/verify/${publicId}/pdf`).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.ok(!served.body.equals(replacement), 'replacement must be processed into a new printable PDF');
  const preservedReplacement = await authed(agent.get(`/api/certificates/${id}/original-pdf`)).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.ok(preservedReplacement.body.equals(replacement));
});

test('listing supports search, status filter and pagination; stats are real', async () => {
  const list = await authed(agent.get('/api/certificates?q=amina&limit=2&page=1'));
  assert.equal(list.status, 200);
  assert.ok(list.body.total >= 1);
  assert.ok(list.body.items.length <= 2);
  const revoked = await authed(agent.get('/api/certificates?status=revoked'));
  assert.ok(revoked.body.items.every((c) => c.status === 'revoked'));
  const stats = await authed(agent.get('/api/certificates/stats'));
  assert.equal(stats.body.total, stats.body.valid + stats.body.revoked);
  assert.equal(stats.body.total, await Certificate.countDocuments({ archivedAt: null }));
  // regex injection is neutralised
  const inj = await authed(agent.get('/api/certificates?q=.*'));
  assert.equal(inj.status, 200);
  assert.equal(inj.body.total, 0);
});

test('archived certificates are no longer publicly verifiable', async () => {
  const r = await upload(makePdf(), fields({ studentName: 'Archive Me' }));
  const { certificateId: id } = r.body.certificate;
  const publicId = verificationId(r.body.certificate);
  assert.equal((await authed(agent.delete(`/api/certificates/${id}`))).status, 400);
  assert.equal((await authed(agent.delete(`/api/certificates/${id}?confirm=true`))).status, 200);
  assert.equal((await agent.get(`/api/verify/${publicId}`)).status, 404);
});

/* 14 – server side: unavailable DB gives 503, never a fake "valid" */
test('when the database is unavailable the verify endpoint returns 503, not a result', async () => {
  const r = await upload(makePdf(), fields({ studentName: 'Outage Test' }));
  const publicId = verificationId(r.body.certificate);
  await disconnectDb();
  const res = await agent.get(`/api/verify/${publicId}`);
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(res.body.status, undefined);
  await connectDb(dbUri());
});

test('error responses never leak stack traces', async () => {
  const res = await agent.post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
  assert.equal(res.status, 400);
  assert.equal(JSON.stringify(res.body).includes('node_modules'), false);
});
