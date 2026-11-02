import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Verify, { classify } from './Verify.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

function renderAt(id = 'CERT-2026-AAAAAAAA') {
  return render(
    <MemoryRouter initialEntries={[`/verify/${id}`]}>
      <Routes><Route path="/verify/:certificateId" element={<Verify />} /></Routes>
    </MemoryRouter>
  );
}

const valid = {
  certificateId: 'CERT-2026-AAAAAAAA', status: 'valid', studentName: 'Amina Uwase', course: 'BSc Computer Science',
  institution: 'Kigali Institute', issueDate: '2026-06-30T00:00:00.000Z', pdfAvailable: true, downloadAllowed: true,
  checkedAt: new Date().toISOString(),
};

describe('verification page never reports a false success', () => {
  it('shows verified details and the PDF buttons for a valid certificate', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(200, valid));
    renderAt();
    expect(await screen.findByText('Certificate Verified')).toBeInTheDocument();
    expect(screen.getByText('Amina Uwase')).toBeInTheDocument();
    const view = screen.getByRole('link', { name: 'View Original PDF Certificate' });
    expect(view).toHaveAttribute('href', '/api/verify/CERT-2026-AAAAAAAA/pdf');
    expect(screen.getByRole('link', { name: 'Download PDF Certificate' })).toBeInTheDocument();
  });

  it('identifies the QR-embedded printable PDF for new records', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(200, { ...valid, pdfContainsQr: true }));
    renderAt();
    expect(await screen.findByText('Printable certificate with embedded QR code')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View printable PDF certificate' })).toBeInTheDocument();
  });

  it('shows a prominent revoked warning and never "Verified"', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(200, { ...valid, status: 'revoked', revokedAt: '2026-08-01T00:00:00Z' }));
    renderAt();
    expect(await screen.findByText('Certificate Revoked')).toBeInTheDocument();
    expect(screen.queryByText('Certificate Verified')).not.toBeInTheDocument();
  });

  it('shows Certificate Not Found for an unknown ID', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(404, { error: { code: 'CERTIFICATE_NOT_FOUND', message: 'x' } }));
    renderAt('CERT-2026-NOPE0000');
    expect(await screen.findByText('Certificate Not Found')).toBeInTheDocument();
    expect(screen.queryByText('Certificate Verified')).not.toBeInTheDocument();
  });

  it.each([
    ['network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['server error', () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } })],
    ['service unavailable', () => json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } })],
    ['HTML error page', () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }))],
    ['200 with garbage body', () => json(200, { hello: 'world' })],
    ['200 with unknown status', () => json(200, { ...valid, status: 'pending' })],
  ])('shows "unavailable" – not valid or invalid – on %s', async (_n, impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    renderAt();
    expect(await screen.findByText('Verification Unavailable')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Certificate Verified')).not.toBeInTheDocument();
      expect(screen.queryByText('Certificate Revoked')).not.toBeInTheDocument();
      expect(screen.queryByText('Certificate Not Found')).not.toBeInTheDocument();
    });
  });

  it('classify() only returns valid for status === "valid"', () => {
    expect(classify({ data: { status: 'valid' } }).kind).toBe('valid');
    expect(classify({ data: {} }).kind).toBe('unavailable');
    expect(classify({ error: { status: 0, code: 'X', message: 'm' } }).kind).toBe('unavailable');
    expect(classify({ error: { status: 404, code: 'CERTIFICATE_NOT_FOUND' } }).kind).toBe('notfound');
  });
});
