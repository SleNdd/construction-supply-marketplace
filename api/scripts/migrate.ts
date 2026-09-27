import 'reflect-metadata';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = join(process.cwd(), 'migrations');
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (existing.rowCount) continue;
      await client.query(readFileSync(join(dir, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      process.stdout.write(`Applied ${name}\n`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
