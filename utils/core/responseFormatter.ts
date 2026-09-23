/**
 * Response formatter utilities
 */
import type { Response } from 'express';

/** Format success response. */
export const sendSuccess = (
  res: Response,
  statusCode: number,
  message: string,
  data: unknown = null
) => {
  const response: { status: string; message: string; data?: unknown } = {
    status: 'success',
    message,
  };

  if (data) {
    response.data = data;
  }

  res.status(statusCode).json(response);
};

/**
 * Format error response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} errors - Additional error details
 */
export const sendError = (
  res: Response,
  statusCode: number,
  message: string,
  errors: unknown = null
) => {
  const response: { status: string; message: string; errors?: unknown } = {
    status: 'error',
    message,
  };

  if (errors) {
    response.errors = errors;
  }

  res.status(statusCode).json(response);
};

/**
 * Format paginated response
 * @param {Object} res - Express response object
 * @param {Array} data - Data array
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items
 */
export const sendPaginatedResponse = (
  res: Response,
  data: unknown,
  page: number,
  limit: number,
  total: number
) => {
  const totalPages = Math.ceil(total / limit);

  res.status(200).json({
    status: 'success',
    data,
    pagination: {
      currentPage: page,
      totalPages,
      itemsPerPage: limit,
      totalItems: total,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
};
