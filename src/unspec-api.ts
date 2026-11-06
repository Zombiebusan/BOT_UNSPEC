import type { Config } from './config.js';
import { InputError, previousDate, snapshotFromWorkzoneCounts, validDate, witaDate, type Snapshot } from './report.js';

export interface LiveUnspecReport {
  date: string;
  fetchedAt: string;
  timestamp: number;
  snapshot: Snapshot;
  previous: Snapshot | null;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function parseLiveUnspec(value: unknown, now = Date.now()): LiveUnspecReport {
  if (!record(value) || value.version !== 1 || value.complete !== true || value.scope !== 'SULBAGSEL' || value.cohort !== 'PROACTIVE_UNSPEC' ||
    typeof value.date !== 'string' || !validDate(value.date) || typeof value.fetchedAt !== 'string') throw new InputError('Format data API UNSPEC tidak valid atau belum lengkap.');
  const time = Date.parse(value.fetchedAt);
  if (!Number.isFinite(time) || time > now + 60_000 || now - time > 120_000 || witaDate(time / 1000) !== value.date) throw new InputError('API tidak mengembalikan snapshot terbaru dengan tanggal WITA yang sesuai.');
  const build = (part: unknown, date: string): Snapshot => {
    if (!record(part) || !record(part.countsByWorkzone) || !Number.isSafeInteger(part.total)) throw new InputError('Agregat API UNSPEC tidak valid.');
    const snapshot = snapshotFromWorkzoneCounts(part.countsByWorkzone as Record<string, number>, date);
    if (snapshot.totalRows !== part.total) throw new InputError('Jumlah tiket API tidak cocok dengan rincian STO.');
    return snapshot;
  };
  const snapshot = build(value.current, value.date);
  let previous: Snapshot | null = null;
  if (value.previous !== null) {
    if (!record(value.previous) || value.previous.date !== previousDate(value.date)) throw new InputError('Tanggal H-1 API harus tepat sehari sebelum tanggal laporan.');
    previous = build(value.previous, value.previous.date as string);
  }
  return { date: value.date, fetchedAt: value.fetchedAt, timestamp: Math.floor(time / 1000), snapshot, previous };
}

export class UnspecApi {
  constructor(private readonly config: Pick<Config, 'unspecApiUrl' | 'unspecApiToken'>) {}
  async latest(timeoutMs = 42000): Promise<LiveUnspecReport> {
    const { unspecApiUrl: url, unspecApiToken: token } = this.config;
    if (!url || !token) throw new InputError('Integrasi API UNSPEC belum dikonfigurasi. Isi UNSPEC_API_URL dan UNSPEC_API_TOKEN.');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid URL');
    } catch { throw new InputError('UNSPEC_API_URL harus berupa URL HTTPS endpoint dashboard.'); }
    try {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new InputError(response.status === 409 ? 'API sedang menyinkronkan data. Tekan Cetak Ulang beberapa saat lagi.' : `API UNSPEC belum dapat digunakan (HTTP ${response.status}). Silakan cetak ulang.`);
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > 128 * 1024) throw new InputError('Respons API UNSPEC melebihi batas ukuran.');
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new InputError('API UNSPEC tidak mengembalikan JSON yang valid.'); }
      return parseLiveUnspec(data);
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError('Pengambilan data API UNSPEC gagal atau melewati batas waktu. Silakan cetak ulang.');
    }
  }
}
