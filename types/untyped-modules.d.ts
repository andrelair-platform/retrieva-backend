// Ambient declarations for runtime deps that ship no TypeScript types.
// They are used at IO/adapter boundaries (PDF/DOCX/ZIP parsing) where the
// shapes are inherently `any`; declaring them here keeps the strict gate happy
// without a per-import `@ts-expect-error`.
declare module 'pdf-parse';
declare module 'mammoth';
declare module 'adm-zip';

// swagger-ui-express ships no types and @types/swagger-ui-express conflicts with the
// repo's peer-dep tree — declare the minimal surface we use (RTV-74).
declare module 'swagger-ui-express' {
  import type { RequestHandler } from 'express';
  export const serve: RequestHandler[];
  export function setup(spec: unknown, options?: unknown): RequestHandler;
  const _default: { serve: RequestHandler[]; setup: typeof setup };
  export default _default;
}
