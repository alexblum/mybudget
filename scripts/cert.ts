import { mkdirSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isIP } from "node:net";
const host = process.argv[2] ?? "localhost";
if (!/^[a-zA-Z0-9.:-]+$/.test(host)) throw new Error("Ungültiger Hostname/IP");
mkdirSync("certs", { recursive: true, mode: 0o700 });
const result = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-keyout",
    "certs/key.pem",
    "-out",
    "certs/cert.pem",
    "-days",
    "365",
    "-subj",
    `/CN=${host}`,
    "-addext",
    `subjectAltName=${isIP(host) ? "IP" : "DNS"}:${host}`,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
chmodSync("certs/key.pem", 0o600);
console.log(
  "Zertifikat erstellt. TLS_KEY=certs/key.pem TLS_CERT=certs/cert.pem konfigurieren.",
);
