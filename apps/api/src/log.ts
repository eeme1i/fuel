type LogLevel = "info" | "warn" | "error";

function errorFields(error: unknown) {
  if (!(error instanceof Error)) return { error: String(error) };
  return {
    error: error.message,
    errorName: error.name,
    stack: error.stack,
    // D1 wraps the SQLite message in `cause`.
    ...(error.cause ? { cause: String(error.cause) } : {}),
  };
}

export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
) {
  const entry = JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export function logError(
  event: string,
  error: unknown,
  fields: Record<string, unknown> = {},
) {
  log("error", event, { ...fields, ...errorFields(error) });
}

export async function loggedOperation<T>(
  name: string,
  operation: () => Promise<T>,
  fields: Record<string, unknown> = {},
) {
  const startedAt = Date.now();
  log("info", `${name}.started`, fields);
  try {
    const result = await operation();
    log("info", `${name}.completed`, {
      ...fields,
      durationMs: Date.now() - startedAt,
      result,
    });
    return result;
  } catch (error) {
    logError(`${name}.failed`, error, {
      ...fields,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
