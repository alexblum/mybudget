import { openDatabase, atomic } from "../src/db.js";
const path = process.env.DB_PATH ?? "data/development.sqlite";
if (!path.includes("development"))
  throw new Error(
    "Seed ist ausschließlich für eine development-Datenbank erlaubt",
  );
const db = openDatabase(path);
try {
  atomic(db, () => {
    const id = Number(
      db
        .prepare("INSERT INTO account(name,type) VALUES('Demo Giro','Giro')")
        .run().lastInsertRowid,
    );
    const insert = db.prepare(
      "INSERT INTO transactions(account_id,booking_date,amount_cents,counterparty,purpose,dedup_hash,dedup_occurrence) VALUES(?,?,?,?,?,?,1)",
    );
    for (let n = 1; n <= 30; n++)
      insert.run(
        id,
        `2026-10-${String(n).padStart(2, "0")}`,
        -1500 - n * 10,
        "Demo Supermarkt",
        "Synthetischer Einkauf",
        `seed-${id}-${n}`,
      );
  });
  console.log(`Synthetische Entwicklungsdaten angelegt: ${path}`);
} finally {
  db.close();
}
