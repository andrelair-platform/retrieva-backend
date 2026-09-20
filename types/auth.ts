// Authenticated user attached to req.user by the auth middleware.
// Postgres row (RTV-49): ids are string UUIDs. Mirrors middleware/auth.js.
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  name: string;
  organizationId: string | null;
}
