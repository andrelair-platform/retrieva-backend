import { ZodError, type ZodTypeAny } from 'zod';
import type { RequestHandler } from 'express';
import logger from '../config/logger.js';
import { sendError } from '../utils/core/responseFormatter.js';

type ValidationSource = 'body' | 'query' | 'params';

/**
 * Validation middleware factory — validates a request part against a Zod schema.
 * @param schema Zod schema to validate against
 * @param source Where to read the data from ('body' | 'query' | 'params')
 */
export const validate = (schema: ZodTypeAny, source: ValidationSource = 'body'): RequestHandler => {
  return async (req, res, next) => {
    try {
      // Handle undefined/null data - default to empty object for body
      const dataToValidate = req[source] ?? (source === 'body' ? {} : {});

      // Validate and parse data - this validates the input
      const validatedData = await schema.parseAsync(dataToValidate);

      // Store validated data for access
      req.validatedData = req.validatedData || {};
      req.validatedData[source] = validatedData;

      // For body, we can replace it directly
      if (source === 'body') {
        req.body = validatedData;
      }
      // For query/params in Express 5, the objects may be read-only
      // Just validate and pass through - controllers use raw req.query

      // Add validated flag for tracking
      req.validated = true;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Format Zod errors for user-friendly response
        const zodErrors = error.issues || [];
        const errors = zodErrors.map((err) => ({
          field: err.path?.join('.') || 'unknown',
          message: err.message || 'Validation error',
        }));

        logger.warn('Validation failed', {
          source,
          errors,
          path: req.path,
        });

        return sendError(res, 400, 'Validation failed', { errors });
      }

      // Unexpected error
      logger.error('Validation middleware error', {
        error: error.message,
        stack: error.stack,
      });

      return sendError(res, 500, 'Internal validation error');
    }
  };
};

/**
 * Validate request body
 */
export const validateBody = (schema) => validate(schema, 'body');

/**
 * Validate query parameters
 */
export const validateQuery = (schema) => validate(schema, 'query');

/**
 * Validate URL parameters
 */
export const validateParams = (schema) => validate(schema, 'params');
