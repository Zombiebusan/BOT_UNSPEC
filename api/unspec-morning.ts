import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../src/http.js';
import { getConfig } from '../src/config.js';
import { UnspecApi, UnspecPendingError } from '../src/unspec-api.js';
import { database, Store } from '../src/store.js';
import { unspecOperationalDate } from '../src/morning-baseline.js';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET');res.status(405).json({ error: 'Method not allowed' });return; }
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(String(req.headers.authorization || '')), expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.status(401).json({ error: 'Unauthorized' });return; }
  try {
    const config = getConfig(), date = unspecOperationalDate(Date.now() / 1000);
    const namespace = createHash('sha256').update(config.token.split(':')[0]!).digest('hex').slice(0, 12);
    const live = await new UnspecApi(config).latest(240000, `opening-${namespace}-${date}`);
    const opening = await new Store(database(config.databaseUrl)).captureUnspecOpening(live, true);
    res.status(200).json({ ok: true, reportDate: live.date, capturedAt: opening?.capturedAt, source: opening?.source });
  } catch (error) {
    if (error instanceof UnspecPendingError) res.setHeader('Retry-After', '3');
    res.status(503).json({ error: 'Acuan awal UNSPEC belum selesai. Ulangi pemanggilan jadwal dengan request yang sama.' });
  }
}
