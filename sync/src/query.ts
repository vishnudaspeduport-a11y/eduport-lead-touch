/** Ad-hoc SQL runner for ops (GitHub Actions "sql" input). Chunks separated by a line "@@" run one by one. */
import postgres from 'postgres';
import { txPooler } from './sync-url.js';

const text = process.env.ADHOC_SQL ?? '';
if (!text.trim()) { console.error('ADHOC_SQL is empty'); process.exit(1); }

const sql = postgres(txPooler(process.env.DATABASE_URL ?? ''), { max: 1, prepare: false, transform: { undefined: null } });
try {
  const chunks = text.split(/\s@@\s/).map((c) => c.trim()).filter(Boolean);
  const out: unknown[] = [];
  for (const chunk of chunks) {
    const t0 = Date.now();
    const rows = /^\s*vacuum/i.test(chunk)
      ? await sql.unsafe(chunk)
      : await sql.begin(async (tx) => { await tx`SET LOCAL statement_timeout = 0`; return tx.unsafe(chunk); });
    out.push({ chunk: chunk.slice(0, 80), ms: Date.now() - t0, rows });
  }
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sql.end({ timeout: 5 });
}
