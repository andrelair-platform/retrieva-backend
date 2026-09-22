// Typed declaration for the JS logger (config/logger.js) — a Winston-compatible wrapper over pino.
// The level methods are assigned dynamically (compat[level] = …), so TS can't infer them from the
// .js; this sidecar gives every converted .ts file a correctly-typed `logger.info/warn/error/…`
// under strict, with no per-call casts. Delete when config/logger.js is converted (RTV-24).
type LogFn = (msgOrObj: string | Record<string, unknown>, meta?: Record<string, unknown>) => void;

export interface Logger {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(bindings: Record<string, unknown>): Logger;
  _pino: unknown;
}

declare const logger: Logger;
export default logger;
