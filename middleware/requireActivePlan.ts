import type { Request, Response, NextFunction } from "express";
/**
 * requireActivePlan middleware
 *
 * Guards paid API routes. Reads the organization's billing/entitlement state (Postgres, via the
 * Drizzle OrganizationRepository) and returns HTTP 402 when the plan is not active/trialing/internal.
 *
 * Pass-through rules:
 *  - No req.user          → next() (public routes, e.g. questionnaire respond)
 *  - org not found / no planStatus → logged security event; next() (fail-open) OR 402 when strict (#156)
 *  - planStatus 'active'   → next()
 *  - planStatus 'internal' → next() (ADR-0004: a provisioned internal tenant, e.g. ktayl-solution IS)
 *  - planStatus 'trialing' + trialEndsAt > now → next()
 *  - anything else         → 402 with { planStatus }
 *
 * #156 hardening (AUD-P0-07): the missing-entitlement path is a latent generic-subscription bypass. The
 * `plan_status` column is NOT NULL default 'trialing', so this path only triggers when the org row is
 * absent (e.g. a token for a deleted org) or a legacy-unprovisioned tenant — on dev, 0 orgs have a null
 * plan_status. We now ALWAYS log it as a security event and, when `REQUIRE_ACTIVE_PLAN_STRICT=true`,
 * DENY (fail-closed). The flag defaults OFF so behaviour is byte-identical until an entitlement backfill
 * is done + the flag flipped (a controlled migration, not a blind flip).
 */

import { organizationRepository } from '../repositories/drizzle/OrganizationRepository.js';
import { sendError } from '../utils/index.js';
import logger from '../config/logger.js';

/** Billing/paywall master switch (AUD-P1 Tier C — scope-down). DISABLED by default: Retrieva is a
 *  self-hosted, single-tenant DORA third-party-ICT-risk product, not a SaaS, so no route is paywalled and
 *  the entitlement check is a no-op. Set BILLING_ENABLED=true to restore the Stripe paywall (SaaS
 *  deployments). This is NOT a security control — authorization is `can()`/`setEntityContext`; this is
 *  only the monetization gate. */
function billingEnabled(): boolean {
  return String(process.env.BILLING_ENABLED || '').toLowerCase() === 'true';
}

/** Fail-closed on a missing/malformed entitlement when enabled. Default OFF (preserves historical
 *  fail-open) until the #156 backfill lands. A DB error still fails open regardless — denying all paid
 *  traffic on a transient DB blip would be a self-inflicted outage. */
function strictEntitlement(): boolean {
  return String(process.env.REQUIRE_ACTIVE_PLAN_STRICT || '').toLowerCase() === 'true';
}

export async function requireActivePlan(req: Request, res: Response, next: NextFunction) {
  // Paywall neutralized (self-hosted profile, the default) → entitlement is a no-op for every route.
  if (!billingEnabled()) {
    return next();
  }
  // Public routes (no auth token) bypass the check
  if (!req.user) {
    return next();
  }

  try {
    const org = req.user.organizationId
      ? await organizationRepository.findById(req.user.organizationId)
      : null;

    // Org not found or billing not yet provisioned → security event + (fail-open | fail-closed per flag)
    if (!org || !org.planStatus) {
      const strict = strictEntitlement();
      logger.warn('requireActivePlan: entitlement missing', {
        service: 'billing',
        securityEvent: 'entitlement_fail_open',
        userId: req.user.userId,
        organizationId: req.user.organizationId ?? null,
        orgFound: !!org,
        strict,
      });
      if (strict) {
        return sendError(res, 402, 'No active subscription for this organization.', {
          planStatus: 'none',
        });
      }
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
