import type { Config } from './config.js';
import { InputError, previousDate, snapshotFromWorkzoneCounts, validDate, witaDate, type Snapshot } from './report.js';

export interface LiveUnspecReport {
  date: string;
  fetchedAt: string;
  timestamp: number;
  snapshot: Snapshot;
  previous: Snapshot | null;
}
export class UnspecPendingError extends Error {
  constructor(readonly requestId: string) { super('Data UNSPEC sedang disiapkan. Pengiriman dilanjutkan otomatis.'); }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function parseLiveUnspec(value: unknown, now = Date.now(), expectedRequestId?: string): LiveUnspecReport {
  if (!record(value) || value.version !== 1 || value.complete !== true || value.scope !== 'SULBAGSEL' || value.cohort !== 'PROACTIVE_UNSPEC' ||
    typeof value.date !== 'string' || !validDate(value.date) || typeof value.fetchedAt !== 'string') throw new InputError('Format data API UNSPEC tidak valid atau belum lengkap.');
  const time = Date.parse(value.fetchedAt);
  let validAge = now - time <= 120_000;
  if (expectedRequestId && value.requestId !== undefined) {
    if (value.requestId !== expectedRequestId || typeof value.requestedAt !== 'string' || typeof value.completedAt !== 'string') throw new InputError('Request ID hasil API tidak sesuai.');
    const requested = Date.parse(value.requestedAt), completed = Date.parse(value.completedAt);
    validAge = Number.isFinite(requested) && Number.isFinite(completed) && time >= requested - 1000 && completed >= time && completed <= now + 60_000 && now - requested <= 24 * 3600_000;
  }
  if (!Number.isFinite(time) || time > now + 60_000 || !validAge || witaDate(time / 1000) !== value.date) throw new InputError('API tidak mengembalikan snapshot terbaru dengan tanggal WITA yang sesuai.');
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
  async latest(timeoutMs = 42000, requestId?: string): Promise<LiveUnspecReport> {
    const { unspecApiUrl: url, unspecApiToken: token } = this.config;
    if (!url || !token) throw new InputError('Integrasi API UNSPEC belum dikonfigurasi. Isi UNSPEC_API_URL dan UNSPEC_API_TOKEN.');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid URL');
    } catch { throw new InputError('UNSPEC_API_URL harus berupa URL HTTPS endpoint dashboard.'); }
    const deadline = Date.now() + timeoutMs;
    let pending = false, poll = false;
    try {
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining < 1) { if (requestId && pending) throw new UnspecPendingError(requestId); throw new Error('Timeout'); }
        const endpoint = new URL(url);
        if (poll) endpoint.searchParams.set('requestId', requestId!);
        const response = await fetch(endpoint.href, {
          method: poll ? 'GET' : 'POST',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(requestId && !poll ? { 'Content-Type': 'application/json' } : {}) },
          ...(requestId && !poll ? { body: JSON.stringify({ requestId }) } : {}),
          redirect: 'error', signal: AbortSignal.timeout(remaining),
        });
        const text = await response.text();
        if (Buffer.byteLength(text) > 128 * 1024) throw new InputError('Respons API UNSPEC melebihi batas ukuran.');
        let data: unknown;
        try { data = JSON.parse(text); } catch { if (response.ok) throw new InputError('API UNSPEC tidak mengembalikan JSON yang valid.'); }
        if (!response.ok) throw new InputError(apiFailureMessage(response.status, record(data) ? data.code : undefined));
        if (response.status === 202) {
          if (!requestId || !record(data) || data.requestId !== requestId || data.status !== 'pending') throw new InputError('Status persiapan API UNSPEC tidak valid.');
          pending = true; poll = true;
          const retry = Number(response.headers.get('retry-after') || '3');
          const delayMs = Number.isFinite(retry) ? Math.max(0, Math.min(5000, retry * 1000)) : 3000;
          if (Date.now() + delayMs >= deadline) throw new UnspecPendingError(requestId);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        return parseLiveUnspec(data, Date.now(), requestId);
      }
    } catch (error) {
      if (error instanceof InputError || error instanceof UnspecPendingError) throw error;
      if (requestId && pending) throw new UnspecPendingError(requestId);
      throw new InputError('Pengambilan data API UNSPEC gagal atau melewati batas waktu. Silakan cetak ulang.');
    }
  }
}

function apiFailureMessage(status: number, code: unknown): string {
  const messages: Record<string, string> = {
    BOT_NOT_CONFIGURED: 'Integrasi bot pada dashboard belum dikonfigurasi. Isi UNSPEC_BOT_API_TOKEN di Vercel dashboard, lalu redeploy.',
    DATABASE_UNAVAILABLE: 'Database dashboard belum dapat diakses. Periksa DATABASE_URL pada proyek dashboard.',
    UPSTREAM_TIMEOUT: 'API sumber MONICA terlalu lama merespons. Silakan tekan cetak kembali beberapa saat lagi.',
    UPSTREAM_HTTP_ERROR: 'API sumber MONICA sedang bermasalah. Silakan tekan cetak kembali beberapa saat lagi.',
    UPSTREAM_CHANGED: 'Data sumber berubah saat pengambilan dan belum lengkap. Silakan cetak kembali.',
    SYNC_FAILED: 'Sinkronisasi sumber atau database dashboard belum berhasil. Silakan cetak kembali.',
    REQUEST_NOT_FOUND: 'Permintaan API tidak ditemukan. Silakan tekan cetak kembali.',
  };
  if (typeof code === 'string' && Object.hasOwn(messages, code)) return messages[code]!;
  if (status === 401) return 'Token integrasi tidak cocok. Samakan UNSPEC_API_TOKEN bot dengan UNSPEC_BOT_API_TOKEN dashboard.';
  return status === 409 ? 'API sedang menyinkronkan data. Tekan Cetak Ulang beberapa saat lagi.' : `API UNSPEC belum dapat digunakan (HTTP ${status}). Silakan cetak ulang.`;
}
