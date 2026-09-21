/** Ad-hoc SQL runner for ops (GitHub Actions "sql" input). Prints result rows as JSON. */
import postgres from 'postgres';
const text = process.env.ADHOC_SQL ?? '';
if (!text.trim()) { console.error('ADHOC_SQL is empty'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, transform: { undefined: null } });
try {
  await sql`SET statement_timeout = 0`;
  const rows = await sql.unsafe(text);
  console.log(JSON.stringify(rows, null, 1));
} finally { await sql.end({ timeout: 5 }); }
