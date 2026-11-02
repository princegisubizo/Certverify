import { useEffect, useId, useRef, useState } from 'react';
import { copyText } from '../api.js';

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="center-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label}</span>
    </div>
  );
}

export function Alert({ kind = 'error', title, children, action }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status === 'valid' ? 'Valid' : 'Revoked'}</span>;
}

export function Field({ label, error, hint, required, children }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children(id, !!error)}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy URL', className = 'btn btn-secondary' }) {
  const [state, setState] = useState('idle');
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        setState((await copyText(text)) ? 'ok' : 'fail');
        setTimeout(() => setState('idle'), 2000);
      }}
    >
      {state === 'ok' ? 'Copied ✓' : state === 'fail' ? 'Press Ctrl+C to copy' : label}
    </button>
  );
}
