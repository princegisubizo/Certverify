import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="center-block">
      <h1>Page not found</h1>
      <p className="muted">The page you’re looking for doesn’t exist. To verify a certificate, scan its QR code or enter its number.</p>
      <Link className="btn btn-primary" to="/">Go to verification home</Link>
    </div>
  );
}
