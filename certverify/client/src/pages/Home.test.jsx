import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Home from './Home.jsx';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/verify/:id" element={<Location />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('verification home', () => {
  it('accepts a pasted verification URL without changing the token case', () => {
    renderHome();
    fireEvent.change(screen.getByRole('textbox', { name: /verification url/i }), {
      target: { value: 'https://certs.example.test/verify/AbCdEf_0123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify certificate' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/verify/AbCdEf_0123');
  });

  it('normalizes legacy certificate numbers for lookup', () => {
    renderHome();
    fireEvent.change(screen.getByRole('textbox', { name: /verification url/i }), {
      target: { value: ' cert-2026-example ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify certificate' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/verify/CERT-2026-EXAMPLE');
  });
});
