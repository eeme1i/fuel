/** Minimal types for the Workers runtime module used by `worker.ts`. */
declare module "cloudflare:workers" {
  export abstract class WorkerEntrypoint<Env = unknown> {
    protected env: Env;
    protected ctx: import("hono").ExecutionContext;
    constructor(ctx: import("hono").ExecutionContext, env: Env);
  }
}
