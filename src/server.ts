import { readFileSync } from "node:fs";
import { createSecureContext } from "node:tls";
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { createApp } from "./app.js";
const host = process.env.HOST ?? "127.0.0.1";
const keyPath = process.env.TLS_KEY,
  certPath = process.env.TLS_CERT;
if ((keyPath && !certPath) || (!keyPath && certPath))
  throw new Error("TLS_KEY und TLS_CERT gemeinsam konfigurieren");
const https =
  keyPath && certPath
    ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
    : undefined;
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !https)
  throw new Error("Netzwerkzugriff erfordert TLS_KEY und TLS_CERT");
if (https) {
  createSecureContext(https);
  const certificate = new X509Certificate(https.cert);
  if (
    Date.now() < Date.parse(certificate.validFrom) ||
    Date.now() > Date.parse(certificate.validTo)
  )
    throw new Error("TLS-Zertifikat ist zeitlich ungültig");
  if (
    !["0.0.0.0", "::"].includes(host) &&
    !(isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host))
  )
    throw new Error("TLS-Zertifikat passt nicht zum konfigurierten Host");
}
const app = await createApp({
  dbPath: process.env.DB_PATH ?? "data/budget.sqlite",
  https,
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ host, port: Number(process.env.PORT ?? 3000) });
console.log(
  `Budget-App bereit auf ${https ? "https" : "http"}://${host}:${process.env.PORT ?? 3000}`,
);
