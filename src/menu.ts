import { BRANCHES } from './master.js';
import type { RichMessage } from './messages.js';
import { InputError, previousDate, validDate } from './report.js';
import type { ValinsKind, ValinsScope } from './valins.js';

export const REPORT_TYPES = ['unspec', 'valins_visit', 'valins_dc', 'valins_all'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export interface ReportPreference { kind: ReportType; scope: ValinsScope | null; date?: string | null }
export interface UploadMenuContext { kind: ReportType; userId: string; threadId: number }
export type MenuAction = { type: 'main' } | { type: 'kind'; kind: ReportType } |
  { type: 'upload'; kind: 'unspec' } | { type: 'live-menu'; kind: 'unspec' } |
  { type: 'live'; kind: 'unspec'; scope: ValinsScope } |
  { type: 'table'; kind: 'unspec'; date?: string } |
  { type: 'branches'; kind: ReportType; date: string } |
  { type: 'branch' | 'print'; kind: ReportType; scope: ValinsScope; date?: string };

export const REPORT_LABELS: Record<ReportType, string> = {
  unspec: 'UNSPEC', valins_visit: 'VALINS ODP', valins_dc: 'VALINS DC', valins_all: 'VALINS ODP DAN DC'
};
export function valinsKind(kind: Exclude<ReportType, 'unspec'>): ValinsKind {
  return kind === 'valins_visit' ? 'visit' : kind === 'valins_dc' ? 'dc' : 'all';
}
export function mainMenu(): RichMessage {
  return {
    text: [
      '👋 Selamat datang di Report Sulbagsel!', '',
      'Buat laporan UNSPEC dan VALINS dengan mudah.', '',
      '1️⃣ Pilih jenis laporan.',
      '2️⃣ UNSPEC: langsung pilih branch, data diambil dari API.',
      '3️⃣ VALINS: upload Excel, lalu pilih branch atau Cetak Semua.', '',
      'Silakan pilih jenis laporan di bawah ini 👇'
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      [{ text: '📊 UNSPEC', callback_data: 'menu:unspec' }],
      [{ text: '📋 VALINS ODP', callback_data: 'menu:valins_visit' }],
      [{ text: '🔎 VALINS DC', callback_data: 'menu:valins_dc' }],
      [{ text: '📑 VALINS ODP DAN DC', callback_data: 'menu:valins_all' }]
    ] }
  };
}
export function liveUnspecMenu(): RichMessage {
  const button = (scope: ValinsScope, text = scope as string) => ({ text, callback_data: `live:unspec:${scope}` });
  return {
    text: ['📊 UNSPEC — DATA API', '', 'Pilih branch, CETAK SEMUA, atau SULBAGSEL REPORT. Bot mengambil posisi terbaru tanpa upload CSV.', '🕗 Hari operasional berganti pukul 08.00 WITA; sebelum itu tetap hari operasional kemarin.', '📈 H-1 menggunakan snapshot hari operasional sebelumnya.', '', 'CSV tetap tersedia untuk arsip dan koreksi tanggal historis.'].join('\n'),
    reply_markup: { inline_keyboard: [
      [button('PARE-PARE'), button('BONE')], [button('KENDARI'), button('MAKASSAR')],
      [button('SEMUA', '🖨 CETAK SEMUA')],
      [{ text: '📊 SULBAGSEL REPORT', callback_data: 'table:unspec:live' }],
      [{ text: '📤 CSV / Arsip', callback_data: 'upload:unspec' }],
      [{ text: '🏠 Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function selectedLiveUnspecMenu(scope: ValinsScope, date: string, fetchedAt: string, hasPrevious: boolean): RichMessage {
  const time = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(fetchedAt));
  return {
    text: [`✅ Pilihan: UNSPEC — ${scope === 'SEMUA' ? 'SEMUA BRANCH' : scope}`, `📅 Tanggal data: ${date}`, `🕒 Posisi API: ${time} WITA`, `📈 H-1: ${previousDate(date)} (${hasPrevious ? 'tersedia' : 'belum tersedia'})`, '', 'Cetak Ulang mengambil posisi API terbaru.', '🖼 Untuk menambahkan gambar, Reply/Balas pesan laporan dengan satu foto.'].join('\n'),
    reply_markup: { inline_keyboard: [
      [{ text: '🖨 Cetak Ulang', callback_data: `live:unspec:${scope}` }],
      [{ text: '⬅️ Ganti Branch', callback_data: 'live:unspec:menu' }, { text: '📤 CSV / Arsip', callback_data: 'upload:unspec' }],
      [{ text: '🏠 Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function selectedUnspecTableMenu(date: string, live: boolean): RichMessage {
  return {
    text: `✅ SULBAGSEL REPORT sudah dicetak.\n📅 Tanggal data: ${date}\n\n${live ? 'SULBAGSEL REPORT mengambil API terbaru saat ditekan kembali.' : 'Tabel menggunakan snapshot CSV sesuai tanggal pilihan.'}`,
    reply_markup: { inline_keyboard: [
      [{ text: '📊 SULBAGSEL REPORT', callback_data: `table:unspec:${live ? 'live' : date}` }],
      [{ text: '⬅️ Ganti Branch', callback_data: live ? 'live:unspec:menu' : `branches:unspec:${date}` }],
      [{ text: '🏠 Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function uploadPrompt(kind: ReportType): RichMessage {
  return {
    text: [
      `📊 ${REPORT_LABELS[kind]}`, '',
      `📤 Silakan upload file ${kind === 'unspec' ? 'CSV (.csv)' : 'Excel (.xlsx)'}.`,
      'Setelah file diproses, tombol pilihan branch dan Cetak Semua akan muncul.', '',
      'Bot menunggu satu file yang sesuai selama 15 menit. Untuk file berikutnya pilih Upload File Baru.', '',
      kind === 'unspec' ? '📅 Tanpa caption, tanggal data otomatis kemarin WITA.' : '📅 Tanpa caption, tanggal arsip mengikuti tanggal upload WITA.',
      ...(kind === 'unspec' ? ['Contoh: upload tanggal 27 → data tanggal 26 → pembanding tanggal 25.'] : []),
      'Untuk tanggal lain, isi caption tanggal, misalnya 2026-10-26.', '',
      ...(kind === 'unspec' ? ['📈 H-1 otomatis memakai data tanggal sebelumnya di chat yang sama.'] :
        ['📈 H-1 dan growth VALINS dibaca dari Sheet1 Excel.'])
    ].join('\n'),
    reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'menu:main' }]] }
  };
}
export function branchMenu(kind: ReportType, date: string, hasPrevious?: boolean): RichMessage {
  const button = (scope: ValinsScope, label: string = scope) => ({ text: label, callback_data: `branch:${kind}:${scope}:${date}` });
  return {
    text: [
      `✅ File ${REPORT_LABELS[kind]} berhasil diproses.`,
      `📅 Tanggal data: ${date}`,
      ...(kind === 'unspec' ? [`📈 Pembanding H-1: ${previousDate(date)}${hasPrevious === undefined ? '' : hasPrevious ? ' (tersedia)' : ' (belum tersedia)'}`] : []), '',
      'Silakan pilih branch yang ingin dicetak.',
      'Tekan Cetak Semua untuk mencetak seluruh branch dari data ini.'
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      [button('PARE-PARE'), button('BONE')],
      [button('KENDARI'), button('MAKASSAR')],
      [button('SEMUA', '🖨 CETAK SEMUA')],
      ...(kind === 'unspec' ? [[{ text: '📊 SULBAGSEL REPORT', callback_data: `table:unspec:${date}` }]] : []),
      [{ text: '📤 Upload File Baru', callback_data: kind === 'unspec' ? 'upload:unspec' : `menu:${kind}` }],
      [{ text: '⬅️ Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function selectedMenu(kind: ReportType, scope: ValinsScope, date: string): RichMessage {
  return {
    text: [
      `✅ Pilihan: ${REPORT_LABELS[kind]} — ${scope === 'SEMUA' ? 'SEMUA BRANCH' : scope}`,
      `📅 Tanggal data: ${date}`, '',
      'Laporan dari file yang Anda upload sudah dicetak.',
      'Gunakan tombol di bawah untuk mencetak branch lain atau mengupload file baru.', '',
      '🖼 Untuk menambahkan gambar, Reply/Balas pesan laporan dengan satu foto.'
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      [{ text: '🖨 Cetak Ulang', callback_data: `print:${kind}:${scope}:${date}` }],
      [{ text: '⬅️ Ganti Branch', callback_data: `branches:${kind}:${date}` }, { text: '📤 Upload File Baru', callback_data: kind === 'unspec' ? 'upload:unspec' : `menu:${kind}` }],
      [{ text: '🏠 Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function parseMenuAction(data: string): MenuAction {
  if (data === 'menu:main') return { type: 'main' };
  if (data === 'upload:unspec') return { type: 'upload', kind: 'unspec' };
  if (data === 'live:unspec:menu') return { type: 'live-menu', kind: 'unspec' };
  if (data === 'table:unspec:live') return { type: 'table', kind: 'unspec' };
  const parts = data.split(':');
  const [action, kind, scope] = parts;
  if (!REPORT_TYPES.includes(kind as ReportType)) throw new InputError('Pilihan menu tidak valid. Ketik /start untuk membuka menu baru.');
  if (action === 'table' && kind === 'unspec' && parts.length === 3 && scope && validDate(scope)) return { type: 'table', kind: 'unspec', date: scope };
  if (action === 'live' && kind === 'unspec' && parts.length === 3 && (scope === 'SEMUA' || BRANCHES.includes(scope as (typeof BRANCHES)[number]))) return { type: 'live', kind: 'unspec', scope: scope as ValinsScope };
  if (action === 'menu' && parts.length === 2) return { type: 'kind', kind: kind as ReportType };
  if (action === 'branches' && parts.length === 3 && scope && validDate(scope)) {
    return { type: 'branches', kind: kind as ReportType, date: scope };
  }
  if ((action === 'branch' || action === 'print') && (parts.length === 3 || (parts.length === 4 && validDate(parts[3]!))) &&
      (scope === 'SEMUA' || BRANCHES.includes(scope as (typeof BRANCHES)[number]))) {
    return { type: action, kind: kind as ReportType, scope: scope as ValinsScope, ...(parts[3] ? { date: parts[3] } : {}) };
  }
  throw new InputError('Pilihan menu tidak valid. Ketik /start untuk membuka menu baru.');
}
