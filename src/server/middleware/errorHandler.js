'use strict';

export function errorHandler(err, req, res, next) {
  console.error('[ServerError]', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
}

export default errorHandler;
