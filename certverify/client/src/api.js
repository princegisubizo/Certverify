export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
export const INSTITUTION = import.meta.env.VITE_INSTITUTION_NAME || 'KIMU TRANSPORT';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', details, network = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.network = network; // true when the server could not be reached at all
  }
}

export const apiUrl = (path) => `${API_BASE}${path}`;

/** Single place that talks to the backend. Never swallows failures into "success". */
export async function api(path, { method = 'GET', body, form, signal } = {}) {
  const init = { method, credentials: 'include', signal, headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(apiUrl(path), init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Could not reach the server. Check your connection and try again.', { network: true });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON (e.g. proxy error page) */
  }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(err?.message || `Request failed (${res.status}).`, {
      status: res.status,
      code: err?.code || (res.status >= 500 ? 'SERVER_ERROR' : 'ERROR'),
      details: err?.details,
    });
  }
  if (data === null) throw new ApiError('The server returned an unexpected response.', { status: res.status, code: 'BAD_RESPONSE' });
  return data;
}

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '—';
export const fmtDateShort = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString() : '—');

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}
