import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../src/config.js';
import { database, Store } from '../src/store.js';
import { Telegram, TelegramError } from '../src/telegram.js';

const config = getConfig();
const sql = database(config.databaseUrl);
const store = new Store(sql);
const telegram = new Telegram(config.token);
try {
  const jobs = await sql<{ update_id: string; chat_id: string }[]>`
    SELECT update_id::text, chat_id FROM telegram_jobs
    WHERE completed_at IS NULL ORDER BY created_at LIMIT 100
  `;
  let recovered = 0;
  for (const job of jobs) {
    let permanent: TelegramError | null = null;
    try {
      await telegram.call('sendChatAction', { chat_id: job.chat_id, action: 'typing' });
    } catch (error) {
      // Only abandon destinations explicitly confirmed as inaccessible/migrated.
      if (error instanceof TelegramError && (error.code === 403 || (error.code === 400 && error.migrateToChatId))) permanent = error;
      else throw error;
    }
    if (!permanent) continue;
    const id = Number(job.update_id);
    const owner = randomUUID();
    const claimed = await store.claim(id, owner);
    if (!claimed) continue;
    try {
      const reason = permanent.migrateToChatId ? 'group_migrated' : 'telegram_403';
      await store.fail(id, owner, permanent.code, reason);
      recovered++;
      console.log(`Update ${job.update_id} dilewati: ${reason}. Pesan dan alasan gagal tetap tersimpan.`);
    } finally { await store.release(id, owner); }
  }
  console.log(`Pemulihan selesai: ${recovered} job gagal permanen dilewati. Data laporan tidak diubah.`);
} catch {
  console.error('Pemulihan antrean gagal sementara. Periksa koneksi dan jalankan db:setup sebelum mencoba ulang.');
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
