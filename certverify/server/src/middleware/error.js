import { ZodError } from 'zod';
import multer from 'multer';
import config from '../config/env.js';
import { AppError } from '../utils/errors.js';

export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}

// Consistent error shape: { error: { code, message, details? } } — never stack traces.
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again later.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Some fields are invalid.';
    details = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!details[key]) details[key] = issue.message;
    }
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `The file is too large. Maximum size is ${config.MAX_UPLOAD_MB} MB.`
        : 'The file upload could not be processed.';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Malformed request body.';
  } else if (err?.name === 'CastError') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Invalid request.';
  }

  if (status >= 500 && !config.isTest) console.error('[error]', err);
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
