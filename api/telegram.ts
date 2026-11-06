import type { ApiRequest, ApiResponse } from '../src/http.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../src/config.js';
import { InputError, parseSnapshot, resolveCsvReportDate, resolveReportDate, validDate } from '../src/report.js';
import { database, Store } from '../src/store.js';
import { Telegram, TelegramError, type TelegramUpdate } from '../src/telegram.js';
import { parseValinsArguments, parseValinsWorkbook } from '../src/valins.js';
import { mainMenu, parseMenuAction, valinsKind, type MenuAction } from '../src/menu.js';
import type { OutgoingMessage } from '../src/messages.js';
import { prepareReportPhoto } from '../src/report-photo.js';
import { UnspecApi } from '../src/unspec-api.js';

const HELP = [
  '📖 PANDUAN SINGKAT', '',
  'MEMBUAT LAPORAN',
  '1. Ketik /start atau /menu.',
  '2. UNSPEC: pilih branch, Cetak Semua, atau Cetak Tabel; data terbaru diambil dari API.',
  '3. VALINS: upload Excel sebagai dokumen, lalu pilih branch atau Cetak Semua.', '',
  '📎 FORMAT FILE',
  '• UNSPEC: tidak wajib upload. CSV (.csv) tetap tersedia untuk arsip/koreksi.',
  '• VALINS ODP / DC: Excel (.xlsx), data di Sheet1.',
  '• Ukuran file maksimal 10 MB.', '',
  '📅 TANGGAL DATA',
  '• API UNSPEC: posisi terbaru hari ini WITA; H-1 dari histori tanggal kemarin.',
  '• CSV UNSPEC tanpa caption: tanggal data otomatis kemarin WITA.',
  '  Contoh: upload tanggal 27 → data tanggal 26 → pembanding tanggal 25.',
  '• Excel VALINS tanpa caption: tanggal arsip mengikuti tanggal upload WITA.',
  'Untuk tanggal lain, isi caption 2026-10-26 atau tanggal=2026-10-26 saat mengirim file.',
  'Anda boleh upload beberapa kali; file terakhir menjadi acuan tanggal tersebut.', '',
  '📈 PEMBANDING H-1',
  '• API UNSPEC: histori dashboard tanggal kemarin; jika belum tersedia, memakai arsip chat pada tanggal yang sama.',
  '• CSV UNSPEC: menggunakan data tanggal sebelumnya di chat yang sama.',
  '• VALINS: menggunakan nilai H-1 yang tersedia di Excel.', '',
  '🖨 CETAK ULANG',
  'Gunakan tombol Cetak Ulang atau Ganti Branch setelah laporan dicetak.',
  'Untuk memilih tanggal: /report 2026-10-26 atau /valins bone 2026-10-26.', '',
  '🖼 LAPORAN BERGAMBAR',
  'Reply/Balas pada pesan laporan bot, lalu kirim satu foto.',
  'Bot mengirim ulang foto dengan teks laporan sebagai caption, siap diteruskan.',
  'Jika teks terlalu panjang untuk caption, foto dan laporan lengkap dikirim sebagai dua pesan.'
].join('\n');

function verifySecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const started = Date.now();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const config = getConfig();
    if (!verifySecret(req.headers['x-telegram-bot-api-secret-token'], config.webhookSecret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    let update: TelegramUpdate;
    try { update = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as TelegramUpdate; }
    catch { res.status(400).json({ error: 'Invalid JSON' }); return; }
    if (!update || !Number.isSafeInteger(update.update_id)) {
      res.status(400).json({ error: 'Invalid update' });
      return;
    }
    const callback = update.callback_query;
    const message = callback?.message ?? update.message;
    const actor = callback?.from ?? message?.from;
    if (!actor || actor.is_bot || !Number.isSafeInteger(actor.id) || !message || !Number.isSafeInteger(message.chat?.id) ||
        !Number.isSafeInteger(message.date) || !Number.isSafeInteger(message.message_id)) {
      res.status(200).json({ ok: true }); return;
    }
    // Join/leave/migration events are not user requests and must not trigger a reply
    // to a group that has just been removed or upgraded to a supergroup.
    if (!callback && !message.text && !message.document && !message.photo?.length) {
      res.status(200).json({ ok: true }); return;
    }
    const chatId = String(message.chat.id);
    const userId = String(actor.id);
    const threadId = message.message_thread_id ?? 0;
    const store = new Store(database(config.databaseUrl));
    const telegram = new Telegram(config.token);
    if (callback) await telegram.answerCallback(callback.id);
    let job = await store.getJob(update.update_id);
    if (!job) {
      try {
        if (callback) {
          const action = parseMenuAction(callback.data ?? '');
          if (action.type === 'live' || (action.type === 'table' && !action.date)) {
            const live = await new UnspecApi(config).latest(Math.max(1000, Math.min(42000, 45000 - (Date.now() - started))));
            if (action.type === 'table') await store.prepareLiveUnspec(update.update_id, chatId, userId, threadId, 'SEMUA', live, 'table');
            else await store.prepareLiveUnspec(update.update_id, chatId, userId, threadId, action.scope, live);
          } else await store.prepareMenu(update.update_id, chatId, userId, threadId, action);
        } else if (message.photo?.length) {
          const messages = prepareReportPhoto(message, config.token.split(':')[0]!);
          await store.prepareMessages(update.update_id, chatId, messages);
        } else if (message.document) {
          const preference = await store.getPreference(chatId, userId, threadId);
          const filename = message.document.file_name?.toLowerCase() ?? '';
          if (filename.endsWith('.xlsx')) {
            const reportDate = resolveReportDate(message.caption, message.date);
            if (preference?.kind === 'unspec') throw new InputError('Pilihan Anda UNSPEC. Kirim CSV (.csv), atau gunakan /start untuk memilih VALINS.');
            const bytes = await telegram.downloadXlsx(message.document);
            const snapshot = await parseValinsWorkbook(bytes);
            const kind = preference?.kind ?? 'valins_all';
            await store.prepareValinsUpload(update.update_id, chatId, message.message_id, message.date, snapshot, reportDate,
              valinsKind(kind), 'PARE-PARE', { kind, userId, threadId });
          } else if (filename.endsWith('.csv')) {
            const reportDate = resolveCsvReportDate(message.caption, message.date);
            if (preference && preference.kind !== 'unspec') throw new InputError('Pilihan Anda VALINS. Kirim Excel (.xlsx), atau gunakan /start untuk memilih UNSPEC.');
            const csv = await telegram.downloadCsv(message.document);
            const snapshot = parseSnapshot(csv, reportDate);
            await store.prepareUpload(update.update_id, chatId, message.message_id, message.date, snapshot, reportDate,
              'SEMUA', { kind: 'unspec', userId, threadId });
          } else {
            throw new InputError('Kirim .csv untuk UNSPEC atau .xlsx untuk VALINS.');
          }
        } else {
          const [rawCommand, date, ...extra] = (message.text ?? '').trim().split(/\s+/);
          const command = rawCommand?.split('@')[0]?.toLowerCase();
          let menu: MenuAction | null = null;
          if (command === '/start' || command === '/menu') menu = { type: 'main' };
          else if (command === '/unspec') menu = { type: 'kind', kind: 'unspec' };
          else if (!date && (command === '/valins' || command === '/valins_visit' || command === '/valins_dc')) {
            menu = { type: 'kind', kind: command === '/valins_visit' ? 'valins_visit' : command === '/valins_dc' ? 'valins_dc' : 'valins_all' };
          }
          if (menu) {
            await store.prepareMenu(update.update_id, chatId, userId, threadId, menu);
          } else {
            let messages: OutgoingMessage[];
            if (command === '/valins' || command === '/valins_visit' || command === '/valins_dc') {
              const options = parseValinsArguments([date, ...extra].filter((value): value is string => Boolean(value)));
              const kind = command === '/valins_visit' ? 'visit' : command === '/valins_dc' ? 'dc' : 'all';
              messages = await store.valinsReport(chatId, kind, options.scope, options.date);
            } else if (command === '/report') {
              if (extra.length || (date && !validDate(date))) throw new InputError('Gunakan /report atau /report YYYY-MM-DD dengan tanggal yang valid.');
              const preference = await store.getPreference(chatId, userId, threadId);
              messages = await store.report(chatId, date ?? preference?.date ?? undefined, preference?.kind === 'unspec' && preference.scope ? preference.scope : 'SEMUA');
            } else {
              messages = [HELP, mainMenu()];
            }
            await store.prepareMessages(update.update_id, chatId, messages);
          }
        }
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        await store.prepareMessages(update.update_id, chatId, [`❌ ${error.message}\n\nSnapshot valid sebelumnya tidak diubah.`]);
      }
      job = await store.getJob(update.update_id);
    }
    if (!job) throw new Error('Job belum tersedia.');
    if (job.delivered >= job.messages.length) { res.status(200).json({ ok: true }); return; }
    const owner = randomUUID();
    const claimed = await store.claim(update.update_id, owner);
    if (!claimed) { res.status(503).json({ error: 'Update sedang diproses, coba ulang.' }); return; }
    let permanentFailure = false;
    try {
      for (let index = claimed.delivered; index < claimed.messages.length; index++) {
        // Stop before Vercel's time limit; Telegram can retry and resume unsent messages.
        if (Date.now() - started > 45000) {
          res.status(503).json({ error: 'Pemrosesan akan dilanjutkan.' });
          return;
        }
        try {
          await telegram.send(chatId, claimed.messages[index]!, message.message_thread_id);
        } catch (error) {
          if (!(error instanceof TelegramError) || ![400, 403, 404].includes(error.code)) throw error;
          const reason = error.migrateToChatId ? 'group_migrated' : `telegram_${error.code}`;
          await store.fail(update.update_id, owner, error.code, reason);
          console.error(`Pengiriman dihentikan: ${reason}.`);
          permanentFailure = true;
          break;
        }
        await store.advance(update.update_id, owner, index + 1, index + 1 === claimed.messages.length);
        // Telegram limits consecutive messages to the same chat.
        if (index + 1 < claimed.messages.length) await new Promise(resolve => setTimeout(resolve, 1100));
      }
    } finally {
      await store.release(update.update_id, owner);
    }
    res.status(200).json({ ok: true, ...(permanentFailure ? { delivery_failed: true } : {}) });
  } catch (error) {
    // Never log raw CSV, customer records, database URLs, or fetch errors containing the bot token.
    console.error('Webhook gagal:', error instanceof TelegramError ? error.message : 'Kesalahan konfigurasi, database, atau pemrosesan.');
    if (error instanceof TelegramError && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    res.status(503).json({ error: 'Pemrosesan gagal sementara. Telegram akan mencoba ulang.' });
  }
}
