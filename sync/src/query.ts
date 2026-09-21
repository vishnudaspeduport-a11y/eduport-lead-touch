/** Ad-hoc SQL runner for ops (GitHub Actions "sql" input). Chunks separated by a line "@@" run one by one. */
import postgres from 'postgres';

const text = process.env.ADHOC_SQL ?? '';
if (!text.trim()) { console.error('ADHOC_SQL is empty'); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, transform: { undefined: null } });
try {
  await sql`SET statement_timeout = 0`;
  // Supabase flips this on when the project is over its disk quota; ops needs write access to free space
  await sql`SET default_transaction_read_only = off`;
  const chunks = text.split(/\s@@\s/).map((c) => c.trim()).filter(Boolean);
  const out: unknown[] = [];
  for (const chunk of chunks) {
    const t0 = Date.now();
    const rows = await sql.unsafe(chunk);
    out.push({ chunk: chunk.slice(0, 80), ms: Date.now() - t0, rows });
  }
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sql.end({ timeout: 5 });
}
