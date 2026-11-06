import 'dotenv/config';
import postgres from 'postgres';
import { Telegram, TelegramError } from '../src/telegram.js';

let failed = false;
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    await sql`SELECT 1 AS connected`;
    const tables = await sql<{ snapshots: string | null; jobs: string | null; valins: string | null; preferences: string | null }[]>`
      SELECT to_regclass('public.daily_snapshots')::text AS snapshots,
             to_regclass('public.telegram_jobs')::text AS jobs,
             to_regclass('public.valins_snapshots')::text AS valins,
             to_regclass('public.report_preferences')::text AS preferences
    `;
    console.log('PostgreSQL: terhubung.');
    console.log(`Tabel aplikasi: ${tables[0]?.snapshots && tables[0]?.jobs && tables[0]?.valins && tables[0]?.preferences ? 'siap' : 'belum lengkap; jalankan npm run db:setup'}.`);
  } catch {
    failed = true;
    console.error('PostgreSQL: gagal terhubung. Periksa credential dan akses jaringan.');
  } finally { await sql.end({ timeout: 5 }); }
} else {
  failed = true;
  console.error('DATABASE_URL belum diisi.');
}

if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    const telegram = new Telegram(process.env.TELEGRAM_BOT_TOKEN);
    const bot = await telegram.call<{ username: string }>('getMe', {});
    const webhook = await telegram.call<{ url: string; pending_update_count: number }>('getWebhookInfo', {});
    console.log(`Telegram: token valid untuk @${bot.username}.`);
    console.log(`Webhook: ${webhook.url ? 'sudah terdaftar' : 'belum terdaftar'}.`);
  } catch (error) {
    failed = true;
    console.error(`Telegram: verifikasi gagal${error instanceof TelegramError ? ` (kode ${error.code})` : ''}. Periksa token dan akses jaringan.`);
  }
} else {
  failed = true;
  console.error('TELEGRAM_BOT_TOKEN belum diisi.');
}

console.log('Akses bot: terbuka untuk semua pengguna Telegram.');
console.log(`Domain Vercel: ${process.env.APP_URL?.trim() ? 'sudah diisi' : 'belum diisi; lengkapi APP_URL setelah deploy'}.`);
if (failed) process.exitCode = 1;
