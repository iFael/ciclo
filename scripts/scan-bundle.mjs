import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".next/static");
const banned = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "PLUGGY_CLIENT_SECRET",
  "PLUGGY_CLIENT_ID",
  "PLUGGY_ITEM_ID",
  "PLUGGY_WEBHOOK_TOKEN",
  "CRON_SECRET",
  "HEALTH_TOKEN",
  "RESEND_API_KEY",
  "BACKUP_ENCRYPTION_KEY",
  "ALLOWED_EMAIL",
  "creditCardMetadata",
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (/\.(js|css|html|json)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const files = await walk(root);
const hits = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const word of banned) {
    if (text.includes(word)) hits.push(`${path.relative(".", file)} contains ${word}`);
  }
}
if (hits.length > 0) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log(`client bundle ok (${files.length} files)`);
