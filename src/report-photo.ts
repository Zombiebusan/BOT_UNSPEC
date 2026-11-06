import { InputError, stripReportTimestamps } from './report.js';
import type { OutgoingMessage, PhotoMessage, ReplyParameters } from './messages.js';
import type { TelegramMessage } from './telegram.js';

export const MAX_PHOTO_CAPTION = 1024;
const REPORT_TITLE = /^📊 SUMMARY (?:PERFORMANSI UNSPEC – BRANCH |VALINS VISIT ODP \(PROV, ASR DAN MAINT\) – |VALINS DC QR CODE & SERVICE – )[^\r\n]+(?:\r?\n|$)/u;

export function prepareReportPhoto(message: TelegramMessage, botId: string): OutgoingMessage[] {
  const original = message.reply_to_message;
  if (!original?.from?.is_bot || String(original.from.id) !== botId || original.chat.id !== message.chat.id) {
    throw new InputError('Untuk membuat laporan bergambar, tekan Reply/Balas pada pesan laporan dari bot ini, lalu kirim satu foto.');
  }
  const source = original.text ?? original.caption;
  if (!source || !REPORT_TITLE.test(source)) {
    throw new InputError('Balas pesan yang berisi laporan UNSPEC atau VALINS, bukan pesan menu atau petunjuk bot.');
  }
  const report = stripReportTimestamps(source);
  const photo = message.photo?.filter(item => item.file_id && item.width > 0 && item.height > 0)
    .reduce<NonNullable<TelegramMessage['photo']>[number] | null>((largest, item) =>
      !largest || item.width * item.height > largest.width * largest.height ||
      (item.width * item.height === largest.width * largest.height && (item.file_size ?? 0) > (largest.file_size ?? 0)) ? item : largest, null);
  if (!photo) throw new InputError('Foto tidak tersedia. Kirim ulang sebagai Foto melalui Reply/Balas pada laporan bot.');
  const reply: ReplyParameters = { message_id: message.message_id, allow_sending_without_reply: true };
  const outgoing: PhotoMessage = {
    type: 'photo', photo: photo.file_id, reply_parameters: reply
  };
  // UTF-16 length is conservative for Telegram's caption limit and preserves all text.
  if (report.length <= MAX_PHOTO_CAPTION) return [{ ...outgoing, caption: report }];
  return [
    { ...outgoing, caption: '📊 Laporan bergambar\nTeks laporan lengkap dikirim pada pesan berikutnya.' },
    { text: report, reply_parameters: reply }
  ];
}
