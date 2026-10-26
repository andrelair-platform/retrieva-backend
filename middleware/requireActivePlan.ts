import type { Request, Response, NextFunction } from "express";
/**
 * requireActivePlan middleware
 *
 * Guards paid API routes. Reads the organization's billing/entitlement state (Postgres, via the
 * Drizzle OrganizationRepository) and returns HTTP 402 when the plan is not active/trialing/internal.
 *
 * Pass-through rules:
 *  - No req.user          → next() (public routes, e.g. questionnaire respond)
 *  - org not found / no planStatus → next() (fail-open — tracked for hardening in #156)
 *  - planStatus 'active'   → next()
 *  - planStatus 'internal' → next() (ADR-0004: a provisioned internal tenant, e.g. ktayl-solution IS)
 *  - planStatus 'trialing' + trialEndsAt > now → next()
 *  - anything else         → 402 with { planStatus }
 */

import { organizationRepository } from '../repositories/drizzle/OrganizationRepository.js';
import { sendError } from '../utils/index.js';
import logger from '../config/logger.js';

export async function requireActivePlan(req: Request, res: Response, next: NextFunction) {
  // Public routes (no auth token) bypass the check
  if (!req.user) {
    return next();
  }

  try {
    const org = req.user.organizationId
      ? await organizationRepository.findById(req.user.organizationId)
      : null;

    // Org not found or billing not yet provisioned → fail-open
    if (!org || !org.planStatus) {
      return next();
    }

    const { planStatus, trialEndsAt } = org;

    // 'internal' (ADR-0004) = a provisioned internal tenant (e.g. ktayl-solution IS); passes like
    // 'active'. It is set ONLY by the provisioner on an internal org, never via public registration,
    // and the org's plan_status is NOT NULL, so this tenant is effectively fail-closed (it always has
    // an explicit entitlement — it never relies on the org-not-found fail-open above; see #156).
    if (planStatus === 'active' || planStatus === 'internal') {
      return next();
    }

    if (planStatus === 'trialing') {
      if (trialEndsAt && trialEndsAt > new Date()) {
        return next();
      }
      // Trial has expired but Stripe hasn't fired the webhook yet — treat as past_due
      return sendError(res, 402, 'Your free trial has expired. Please add a payment method.', {
        planStatus: 'past_due',
      });
    }

    const messages = {
      past_due: 'Your payment is past due. Please update your billing information.',
      canceled: 'Your subscription has been canceled.',
      paused: 'Your subscription is paused. Please add a payment method to continue.',
    };

    return sendError(res, 402, messages[planStatus as keyof typeof messages] || 'Your subscription is not active.', {
      planStatus,
    });
  } catch (err) {
    // On DB error, fail-open to avoid blocking legitimate requests
    logger.error('requireActivePlan: failed to check org billing status', {
      service: 'billing',
      userId: req.user?.userId,
      error: (err instanceof Error ? err.message : String(err)),
    });
    return next();
  }
}
