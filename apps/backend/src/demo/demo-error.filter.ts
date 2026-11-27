import { ArgumentsHost, Catch, ExceptionFilter, ForbiddenException, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { rlsRefusal } from "../tenancy/visibility";

const DEMO_CODE = /^demo_[a-z_]+$/;

/** The `demo_*` code a demo trigger raised, also when Drizzle wrapped the Postgres error. */
export function demoTriggerCode(err: unknown): string | null {
  for (let e = err as { message?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 3; e = e.cause as typeof e, depth++) {
    if (e instanceof HttpException) return null;
    if (typeof e.message === "string" && DEMO_CODE.test(e.message)) return e.message;
  }
  return null;
}

/**
 * Turns the demo triggers' exceptions (migration 0068) into a 403 with the
 * code, instead of a 500. So too a row-level refusal that reached no service
 * mapping, e.g. an 'edit_own' member saving someone else's invoice
 * (`record_read_only`, see tenancy/visibility.ts). Everything else goes to
 * Nest's default handling.
 */
@Catch()
export class DemoErrorFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== "http") return super.catch(exception, host);
    const code = demoTriggerCode(exception);
    super.catch(code ? new ForbiddenException(code) : (rlsRefusal(exception) ?? exception), host);
  }
}
