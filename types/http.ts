import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Standard JSON envelopes returned by the API (see utils/core/responseFormatter.js).
export interface ApiSuccess<T = unknown> {
  status: 'success';
  message?: string;
  data?: T;
}

export interface ApiError {
  status: 'error' | 'fail';
  message: string;
  code?: string;
  errors?: Array<{ field: string; message: string }>;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// A controller/handler that may be async. Express swallows a rejected promise
// unless wrapped, so async controllers should still forward errors via next()
// (the global error handler catches thrown AppErrors).
export type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

export type { Request, Response, NextFunction, RequestHandler };
