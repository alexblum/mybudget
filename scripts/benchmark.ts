import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, cpus, totalmem, release } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { openDatabase, atomic } from "../src/db.js";
import { createApp } from "../src/app.js";
const dir = mkdtempSync(join(tmpdir(), "budget-bench-")),
  path = join(dir, "bench.sqlite");
const db = openDatabase(path);
atomic(db, () => {
  for (let n = 1; n <= 4; n++)
    db.prepare("INSERT INTO account(id,name,type) VALUES(?,?,'Giro')").run(
      n,
      `Demo ${n}`,
    );
  const insert = db.prepare(
    "INSERT INTO transactions(account_id,booking_date,amount_cents,counterparty,purpose,category_id,dedup_hash,dedup_occurrence) VALUES(?,?,?,?,?,?,?,1)",
  );
  for (let n = 0; n < 50_000; n++) {
    const year = 2022 + (n % 5),
      m = 1 + (Math.floor(n / 5) % 12),
      day = 1 + (Math.floor(n / 60) % 28);
    insert.run(
      1 + (n % 4),
      `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      -1000 - (n % 10000),
      "Demo Händler",
      "Synthetisch",
      1 + (n % 10),
      `bench-${n}`,
    );
  }
  for (let y = 2022; y <= 2026; y++)
    for (let m = 1; m <= 12; m++)
      for (let c = 1; c <= 10; c++)
        db.prepare(
          "INSERT INTO budget(month,category_id,amount_cents) VALUES(?,?,100000)",
        ).run(`${y}-${String(m).padStart(2, "0")}`, c);
});
db.close();
const app = await createApp({ dbPath: path });
try {
  const auth = await app.inject("/api/auth");
  const setup = await app.inject({
    method: "POST",
    url: "/api/auth/setup",
    headers: {
      cookie: String(auth.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": auth.json().csrf,
    },
    payload: { password: "benchmark-password" },
  });
  assert.equal(setup.statusCode, 200);
  const headers = { cookie: String(setup.headers["set-cookie"]).split(";")[0] };
  console.log(
    JSON.stringify({
      node: process.version,
      os: release(),
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memory_gib: Math.round(totalmem() / 1024 ** 3),
      rows: 50000,
      storage: "temporary local filesystem; SSD must be verified by operator",
    }),
  );
  for (const url of [
    "/api/dashboard?month=2026-11",
    "/api/transactions?month=2026-11&account_id=1&text=Demo&page=0",
  ]) {
    await app.inject({ url, headers });
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const response = await app.inject({ url, headers });
      assert.equal(response.statusCode, 200, response.body);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    console.log(
      JSON.stringify({
        url,
        requests: 30,
        p95_ms: Number(p95.toFixed(2)),
        limit_ms: 500,
      }),
    );
    assert.ok(p95 <= 500, `${url}: p95 überschritten`);
  }
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
