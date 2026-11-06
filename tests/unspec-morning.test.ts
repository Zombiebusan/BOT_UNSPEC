import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/unspec-morning.js';
import { Store } from '../src/store.js';
import { UnspecApi, UnspecPendingError } from '../src/unspec-api.js';
import { Telegram } from '../src/telegram.js';
import { parseSnapshot } from '../src/report.js';
import { baselineFromSnapshot } from '../src/morning-baseline.js';
import type { ApiRequest, ApiResponse } from '../src/http.js';

test('bot morning cron authenticates, captures the opening once, and sends no Telegram messages', async t => {
  const original = { ...process.env };
  Object.assign(process.env, { CRON_SECRET: 'test-cron-secret-32-characters-long', TELEGRAM_BOT_TOKEN: '777:test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected' });
  const now = Date.parse('2026-11-06T00:01:00Z');t.mock.method(Date, 'now', () => now);
  const live = { date: '2026-11-06', timestamp: now/1000, fetchedAt: new Date(now).toISOString(), snapshot: parseSnapshot('INCIDENT,WORKZONE\nI1,ANT','2026-11-06'), previous: null };
  const latest = t.mock.method(UnspecApi.prototype, 'latest', async () => live);
  const capture = t.mock.method(Store.prototype, 'captureUnspecOpening', async () => baselineFromSnapshot(live.snapshot, live.fetchedAt));
  const send = t.mock.method(Telegram.prototype, 'send', async () => { throw new Error('Cron must not send reports'); });
  const run = async (method: string, secret = '') => {
    let status = 0;let body: any;
    const response = { setHeader() {}, status(code: number) { status=code;return this; }, json(value: unknown) { body=value; } } as unknown as ApiResponse;
    await handler({ method, headers: { authorization: secret ? `Bearer ${secret}` : '' } } as unknown as ApiRequest, response);
    return { status, body };
  };
  try {
    assert.equal((await run('POST')).status,405);assert.equal((await run('GET','wrong')).status,401);
    const good=await run('GET',process.env.CRON_SECRET);assert.equal(good.status,200);assert.equal(good.body.reportDate,'2026-11-06');
    const requestId=latest.mock.calls[0]!.arguments[1];await run('GET',process.env.CRON_SECRET);
    assert.equal(latest.mock.calls[1]!.arguments[1],requestId);assert.equal(capture.mock.calls[0]!.arguments[1],true);assert.equal(send.mock.callCount(),0);
    latest.mock.mockImplementation(async()=>{throw new UnspecPendingError('opening-pending')});
    assert.equal((await run('GET',process.env.CRON_SECRET)).status,503);
  } finally {
    for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);
  }
});
