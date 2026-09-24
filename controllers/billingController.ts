import type { Request, Response, NextFunction } from "express";
/**
 * Billing Controller
 *
 * Verifies Stripe webhook signatures and dispatches events to BillingService.
 * Also exposes the customer-portal session endpoint.
 *
 * @module controllers/billingController
 */

import { getStripe } from '../config/stripe.js';
import { billingService } from '../services/BillingService.js';
import { catchAsync, sendError, sendSuccess } from '../utils/index.js';
import logger from '../config/logger.js';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * POST /api/v1/billing/portal — create Stripe Customer Portal session
 */
export const createPortalSession = catchAsync(async (req: Request, res: Response) => {
  const { url } = await billingService.createPortalSession(req.user!.organizationId as string);
  sendSuccess(res, 200, 'Portal session created', { url });
});

/**
 * Webhook entry point (raw body required — mounted before express.json())
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig as string, WEBHOOK_SECRET as string);
  } catch (err: unknown) {
    logger.warn('Stripe webhook signature verification failed', {
      service: 'billing',
      error: (err instanceof Error ? err.message : String(err)),
    });
    return sendError(res, 400, `Webhook Error: ${(err instanceof Error ? err.message : String(err))}`);
  }

  try {
    await billingService.dispatchWebhookEvent(event);
    res.json({ received: true });
  } catch (err: unknown) {
    logger.error('Stripe webhook handler error', {
      service: 'billing',
      eventType: event.type,
      error: (err instanceof Error ? err.message : String(err)),
    });
    // Return 200 anyway to prevent Stripe retries for internal errors
    res.json({ received: true, warning: 'Handler error logged' });
  }
}
