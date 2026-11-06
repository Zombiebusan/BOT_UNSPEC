import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('Isi DATABASE_URL di .env terlebih dahulu.');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
try {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await sql.begin(async tx => { await tx.unsafe(schema); });
  console.log('Database siap. Tabel dibuat tanpa menghapus data yang sudah ada.');
} catch {
  console.error('Setup database gagal. Periksa DATABASE_URL dan akses database.');
  process.exitCode = 1;
} finally { await sql.end(); }
