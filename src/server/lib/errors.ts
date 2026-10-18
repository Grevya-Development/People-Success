export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "PRECONDITION"
  | "INTEGRATION"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  PRECONDITION: 412,
  INTEGRATION: 502,
  INTERNAL: 500,
};

/**
 * Errors the user is allowed to see. Anything else is logged and reported as
 * a generic internal error so internals never leak to the client.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { fieldErrors?: Record<string, string[]>; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = opts.fieldErrors;
    this.details = opts.details;
  }

  get status() {
    return STATUS[this.code];
  }
}

export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError("FORBIDDEN", message);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const invalidState = (message: string) => new AppError("INVALID_STATE", message);
export const conflict = (message: string) => new AppError("CONFLICT", message);
export const validation = (message: string, fieldErrors?: Record<string, string[]>) =>
  new AppError("VALIDATION", message, { fieldErrors });

type PgError = { code?: string; constraint_name?: string; constraint?: string; message?: string };

/** Translate well-known Postgres errors into user-facing AppErrors. */
export function fromDatabaseError(err: unknown): AppError | null {
  const cause = (err as { cause?: unknown })?.cause ?? err;
  const pg = cause as PgError;
  if (!pg || typeof pg.code !== "string") return null;
  const constraint = pg.constraint_name ?? pg.constraint ?? "";
  switch (pg.code) {
    case "23505":
      return new AppError("CONFLICT", "A record with these details already exists.", {
        details: { constraint },
      });
    case "23503":
      return new AppError("VALIDATION", "A referenced record does not exist or is not accessible.", {
        details: { constraint },
      });
    case "23514":
      return new AppError("VALIDATION", pg.message?.includes("loop") ? pg.message : "The data violates a business rule.", {
        details: { constraint },
      });
    case "23P01":
      return new AppError("CONFLICT", "This overlaps an existing effective-dated record.", {
        details: { constraint },
      });
    case "42501":
      return new AppError("FORBIDDEN", "You do not have permission to do that.");
    case "P0001":
      return new AppError("INVALID_STATE", pg.message ?? "Operation not allowed.");
    default:
      return null;
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return fromDatabaseError(err) ?? new AppError("INTERNAL", "Something went wrong. Please try again.");
}
