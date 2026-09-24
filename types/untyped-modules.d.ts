// Ambient declarations for runtime deps that ship no TypeScript types.
// They are used at IO/adapter boundaries (PDF/DOCX/ZIP parsing) where the
// shapes are inherently `any`; declaring them here keeps the strict gate happy
// without a per-import `@ts-expect-error`.
declare module 'pdf-parse';
declare module 'mammoth';
declare module 'adm-zip';
