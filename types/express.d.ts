import type { AuthenticatedUser } from './auth.js';
import type { VendorPrincipal } from '../services/security/vendorPrincipal.js';
import type { ServicePrincipal } from '../services/security/servicePrincipal.js';
import type { Principal } from '../middleware/principal.js';

// Loose workspace shape the Express layer reads off req.workspace. The full
// record is a Drizzle row returned by the (.js) workspace repository; the index
// signature keeps this compatible without coupling the Express layer to the schema.
export interface WorkspaceContext {
  id: string;
  userId: string;
  name?: string;
  [key: string]: unknown;
}

// Declaration merging: augment Express's Request with the custom props set by
// our middleware (auth.js, loadWorkspace.js, app.js request-id, validate.js).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      // The external vendor_contact principal resolved from a questionnaire token (RTV-56) —
      // set by requireVendorPrincipal on the public portal routes. NEVER a staff user.
      vendor?: VendorPrincipal;
      // The M2M SERVICE principal resolved from an Authentik client-credentials token (ADR-0004) —
      // set by requireServicePrincipal on the service surface. NEVER a staff user (separate chain).
      service?: ServicePrincipal;
      // Principal-agnostic context (ADR-0004 incr 3) — set by optionalPrincipal on the evaluation
      // surface; normalizes staff OR service without conflating them (preserves type/authMethod).
      principal?: Principal;
      workspace?: WorkspaceContext;
      workspaceMembership?: unknown;
      membership?: unknown;
      isWorkspaceOwner?: boolean;
      // Workspaces the authenticated user may query (set by workspace-scope middleware).
      authorizedWorkspaces?: Array<Record<string, unknown>>;
      requestId?: string;
      logContext?: Record<string, unknown>;
      validated?: boolean;
      validatedData?: Record<string, unknown>;
    }
  }
}

export {};
