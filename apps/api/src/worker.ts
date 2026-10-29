import { WorkerEntrypoint } from "cloudflare:workers";
import type { Bindings } from "./db";
import worker, { app } from "./index";

export default worker;

/**
 * Entrypoint for the web app's service binding. It is unreachable from the internet, so its
 * requests are marked trusted and skip public rate limits.
 */
export class TrustedApi extends WorkerEntrypoint<Bindings> {
  fetch(request: Request) {
    return app.fetch(request, { ...this.env, TRUSTED: true }, this.ctx);
  }
}
