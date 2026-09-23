/**
 * Structured JSON logger with redaction. Never logs secrets, credentials, or
 * sensitive person inputs (emails, phones, free text). Log *counts and ids*,
 * not payloads.
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /(key|secret|token|password|passwd|authorization|cookie|session|email|phone|freetext|free_text|otherinfo|content)/i;
const SECRET_VALUE = /(AIza[0-9A-Za-z_-]{20,}|tvly-[0-9A-Za-z]{10,}|sk-[0-9A-Za-z]{10,}|ghp_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,})/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[redacted]").replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, "$1[redacted]");
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (process.env.APP_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(fields ? (redact(fields) as object) : {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => (process.env.LOG_LEVEL === "debug" ? emit("debug", msg, f) : undefined),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
