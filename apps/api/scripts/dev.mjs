#!/usr/bin/env node
/**
 * Starts `wrangler dev` with a CA bundle workerd can verify every data source against.
 *
 * Locally, workerd trusts only the OpenSSL bundle (`/etc/ssl/cert.pem` on macOS), not the system
 * keychain. That bundle can lag behind: macOS's lacks Sectigo Public Server Authentication Root
 * E46, which the ECB API chains to, so the FX sync failed with "internal error". This adds Node's
 * bundled Mozilla roots and points workerd at the result through SSL_CERT_FILE.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rootCertificates } from "node:tls";

const systemBundle = [
  process.env.SSL_CERT_FILE,
  "/etc/ssl/cert.pem",
  "/etc/ssl/certs/ca-certificates.crt",
].find((path) => path && existsSync(path));

const dir = new URL("../.wrangler/", import.meta.url);
mkdirSync(dir, { recursive: true });
const bundle = new URL("ca-bundle.pem", dir);
writeFileSync(
  bundle,
  [
    systemBundle ? readFileSync(systemBundle, "utf8") : "",
    ...rootCertificates,
  ].join("\n") + "\n",
);

// The project's wrangler, not a global one that may be too old for the compatibility date.
const wrangler = new URL(
  `../node_modules/.bin/wrangler${process.platform === "win32" ? ".cmd" : ""}`,
  import.meta.url,
);
const child = spawn(wrangler.pathname, ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, SSL_CERT_FILE: bundle.pathname },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) =>
  signal ? process.kill(process.pid, signal) : process.exit(code ?? 0),
);
