/**
 * Authentication Middleware
 * Handles JWT authentication and role-based authorization
 *
 * Supports two authentication methods:
 * 1. HTTP-only cookies (primary, more secure for browsers)
 * 2. Authorization header (fallback for API clients, mobile apps)
 *
 * @module middleware/auth
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedUser } from "../types/auth.js";
import { verifyAccessToken } from '../utils/security/jwt.js';
import { userRepository } from '../repositories/drizzle/UserRepository.js';
import { sendError } from '../utils/core/responseFormatter.js';
import { getAccessToken } from '../utils/security/cookieConfig.js';
import { authAuditService } from '../services/authAuditService.js';
import logger from '../config/logger.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 */

// Normalise an unknown thrown value to a message string / name — pulled out so the ternary
// doesn't inflate the surrounding middleware's cyclomatic complexity.
const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const errName = (error: unknown): string => (error instanceof Error ? error.name : '');

// Map a sanitized user row to the request-attached AuthenticatedUser shape (shared by both
// authenticate + optionalAuth so the field-mapping branches live in one place).
const toAuthenticatedUser = (user: Awaited<ReturnType<typeof userRepository.findById>>): AuthenticatedUser =>
  ({
    userId: user!.id,
    email: user!.email,
    role: user!.role,
    name: user!.name,
    organizationId: user!.organizationId || null,
    platformAdmin: user!.platformAdmin === true, // RTV-52: SaaS-operator flag (can() allow-all)
  }) as AuthenticatedUser;

/**
 * @typedef {Object} AuthenticatedUser
 * @property {import('mongoose').Types.ObjectId} userId - User's MongoDB ID
 * @property {string} email - User's email address
 * @property {'user'|'admin'} role - User's role
 * @property {string} name - User's display name
 */

/**
 * @typedef {Request & { user?: AuthenticatedUser }} AuthenticatedRequest
 */

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 *
 * Token sources (checked in order):
 * 1. HTTP-only cookie 'accessToken' (primary, secure)
 * 2. Authorization header 'Bearer <token>' (fallback for API clients)
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Next middleware function
 * @returns {Promise<void>}
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  // Idempotent — skip if already authenticated by an outer middleware
  if (req.user) return next();

  try {
    // Get token from cookie or Authorization header
    const token = getAccessToken(req);

    if (!token) {
      logger.warn('No token provided', { path: req.path, ip: req.ip });
      return sendError(res, 401, 'Authentication required');
    }

    // Verify token
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (error) {
      logger.warn('Invalid token', { error: errMessage(error), path: req.path, ip: req.ip });
      return sendError(res, 401, errMessage(error) || 'Invalid token');
    }

    // Get user from database
    const user = await userRepository.findById(decoded.userId);

    if (!user) {
      logger.warn('User not found for token', { userId: decoded.userId });
      return sendError(res, 401, 'User not found');
    }

    if (!user.isActive) {
      logger.warn('Inactive user attempted access', { userId: user.id });
      return sendError(res, 401, 'Account is inactive');
    }

    // Attach user to request (repo returns a sanitized row: id, decrypted name)
    req.user = toAuthenticatedUser(user);

    logger.debug('User authenticated', {
      userId: user.id,
      email: user.email,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('Authentication middleware error', {
      error: errMessage(error),
      stack: (error as Error).stack,
    });
    return sendError(res, 500, 'Authentication failed');
  }
};

/**
 * Authorization middleware factory — checks the **global** `User.role`
 * (`user` | `admin`). Must run after `authenticate`.
 *
 * SCOPE (audit gap B3): this gates routes on the platform-wide role only.
 * Tenant-scoped access (the common case) is NOT handled here — use
 * `requireWorkspaceAccess` / workspace membership permissions in
 * `middleware/workspaceAuth.js` instead. This factory is intended for the
 * narrow set of admin-only / platform routes and is intentionally kept (not
 * deprecated) for that purpose. If you reach for it on a workspace resource,
 * you almost certainly want `requireWorkspaceAccess`.
 *
 * @param {...('user'|'admin')} roles - Allowed global roles for this route
 * @returns {function(Request, Response, NextFunction): void} Express middleware
 */
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      logger.error('Authorization called without authentication');
      return sendError(res, 401, 'Authentication required');
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Unauthorized access attempt', {
        userId: req.user.userId,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
      });
      return sendError(res, 403, `Forbidden. Required role: ${roles.join(' or ')}`);
    }

    logger.debug('User authorized', {
      userId: req.user.userId,
      role: req.user.role,
      path: req.path,
    });

    next();
  };
};

/**
 * Optional authentication middleware
 * Attaches user to request if valid token present, but doesn't require it
 * Useful for endpoints that behave differently for authenticated vs anonymous users
 *
 * Token sources (checked in order):
 * 1. HTTP-only cookie 'accessToken'
 * 2. Authorization header 'Bearer <token>'
 *
 * SECURITY FIX: Now logs failed token attempts for monitoring
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Next middleware function
 * @returns {Promise<void>}
 */
// Resolve + attach the user for optionalAuth (best-effort): on a valid token for an active user it
// attaches req.user; an inactive user or an invalid token is logged (A5 audit) but never fatal.
const resolveOptionalUser = async (req: Request, token: string): Promise<void> => {
  try {
    const decoded = verifyAccessToken(token);
    const user = await userRepository.findById(decoded.userId);

    if (user && user.isActive) {
      req.user = toAuthenticatedUser(user);
    } else if (user && !user.isActive) {
      // SECURITY FIX: Log inactive user token usage
      logger.warn('Optional auth - inactive user token detected', {
        userId: decoded.userId,
        path: req.path,
        ip: req.ip,
      });
    }
  } catch (error) {
    // SECURITY FIX: Log failed token attempts for security monitoring
    // This helps detect token theft/replay attempts
    logger.warn('Optional auth - invalid token detected', {
      error: errMessage(error),
      errorType: errName(error),
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100),
    });

    // A5: record the invalid/replayed token as an auth audit event.
    authAuditService.logTokenTheftDetected?.({
      path: req.path,
      ip: req.ip,
      errorType: errName(error),
    });
  }
};

export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from cookie or Authorization header
    const token = getAccessToken(req);

    if (!token) {
      // No token provided, continue without user
      return next();
    }

    await resolveOptionalUser(req, token);
    next();
  } catch (error) {
    logger.error('Optional auth middleware error', { error: errMessage(error) });
    next(); // Continue even if error
  }
};
