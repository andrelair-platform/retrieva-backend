import type { AuthenticatedUser } from './auth.js';

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
