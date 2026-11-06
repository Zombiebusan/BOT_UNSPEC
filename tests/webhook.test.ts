import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/telegram.js';
import type { ApiRequest, ApiResponse } from '../src/http.js';
import { Store, type Job } from '../src/store.js';
import { Telegram, TelegramError, type TelegramMessage } from '../src/telegram.js';
import type { SheetData } from 'read-excel-file/node';
import { workbookBytes } from './helpers/xlsx.js';
import type { ReportPreference } from '../src/menu.js';
import type { OutgoingMessage } from '../src/messages.js';
import { UnspecApi, UnspecPendingError, type LiveUnspecReport } from '../src/unspec-api.js';
import { InputError, parseSnapshot, renderReports, witaDate } from '../src/report.js';
import { unspecTableMessages } from '../src/unspec-table.js';

test('webhook verifies the secret and accepts all users without an account allowlist', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678',
    DATABASE_URL: 'postgresql://not-connected'
  });
  const lookup = t.mock.method(Store.prototype, 'getJob', async (updateId: number) => ({
    update_id: String(updateId), chat_id: 'test', messages: ['already sent'], delivered: 1
  }));
  const run = async (method: string, secret: string, body: unknown): Promise<number> => {
    let status = 0;
    const res = {
      setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; }
    } as unknown as ApiResponse;
    await handler({ method, headers: { 'x-telegram-bot-api-secret-token': secret }, body } as unknown as ApiRequest, res);
    return status;
  };
  try {
    assert.equal(await run('GET', '', {}), 405);
    assert.equal(await run('POST', 'wrong-secret', {}), 401);
    assert.equal(await run('POST', 'test_secret_12345678', '{bad json'), 400);
    assert.equal(await run('POST', 'test_secret_12345678', {}), 400);
    assert.equal(await run('POST', 'test_secret_12345678', {
      update_id: 1, message: { from: { id: 999 }, chat: { id: 999 }, date: 1, message_id: 1, text: '/start' }
    }), 200);
    assert.equal(await run('POST', 'test_secret_12345678', {
      update_id: 2, message: { from: { id: 100 }, chat: { id: -100999 }, date: 1, message_id: 2, text: '/start' }
    }), 200);
    assert.equal(await run('POST', 'test_secret_12345678', {
      update_id: 3, message: { from: { id: 100 }, chat: { id: -999 }, date: 1, message_id: 3, migrate_to_chat_id: -100999 }
    }), 200);
    assert.equal(lookup.mock.callCount(), 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('XLSX upload is parsed and stored as VALINS; VALINS command selects the requested report', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected'
  });
  const rows: SheetData = [];
  const metrics = (label: string): SheetData[number] => [
    null,label,100,90,10,.9,0,0,0,1,92.27,.95,.94,.01,label,1000,950,null,960,950,940,50,95,.94,.95,-.01
  ];
  for (const [branch, sto] of [['BONE','WTP'],['KENDARI','KDR'],['MAKASSAR','BAL'],['PARE-PARE','WON']]) {
    rows.push(
      [null,'VALINS VISIT ODP',null,null,null,null,null,null,null,null,null,'TOTAL',null,'GROWTH','VALINS DC QR CODE & SERVICE'],
      [null,'SA / STO','ONT BARU','VALINS PSB','BELUM VALINS','REAL','ONT BERUBAH PORT','VALINS OMSET','BELUM VALINS','REAL','TARGET',null,null,null,'SA / STO','ONT IN SERVICE','QR CODE VALINS',null,'SUDAH VALINS','VALINS To UIM','SUCCESS UIM','BELUM VALINS','TARGET'],
      [null,null,null,null,null,null,null,null,null,null,null,'H','H-1',null,null,null,null,null,null,null,null,null,null,'H','H-1'],
      metrics(sto!), metrics(branch!)
    );
  }
  const lookups = new Map<number, number>();
  t.mock.method(Store.prototype, 'getJob', async (id: number) => {
    const count = lookups.get(id) ?? 0;
    lookups.set(id, count + 1);
    return count ? { update_id: String(id), chat_id: '123', messages: ['prepared'], delivered: 1 } : null;
  });
  const download = t.mock.method(Telegram.prototype, 'downloadXlsx', async () => workbookBytes(rows));
  let preference: ReportPreference | null = null;
  t.mock.method(Store.prototype, 'getPreference', async () => preference);
  const upload = t.mock.method(Store.prototype, 'prepareValinsUpload', async () => {});
  const command = t.mock.method(Store.prototype, 'valinsReport', async () => ['chosen report']);
  const messages = t.mock.method(Store.prototype, 'prepareMessages', async () => {});
  const csv = t.mock.method(Store.prototype, 'prepareUpload', async () => {});
  t.mock.method(Telegram.prototype, 'downloadCsv', async () => 'INCIDENT,WORKZONE\nINC1,WON');
  const run = async (updateId: number, message: object): Promise<number> => {
    let status = 0;
    const res = {
      setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; }
    } as unknown as ApiResponse;
    await handler({
      method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' },
      body: { update_id: updateId, message: {
        from: { id: 123 }, chat: { id: 123 }, message_id: updateId, date: 1793062800, ...message
      } }
    } as unknown as ApiRequest, res);
    return status;
  };
  try {
    assert.equal(await run(10, { document: { file_id: 'file', file_name: 'report.xlsx' }, caption: '2026-10-26' }), 200);
    assert.equal(download.mock.callCount(), 1);
    assert.equal(upload.mock.callCount(), 1);
    assert.equal(csv.mock.callCount(), 0);
    assert.equal(upload.mock.calls[0]!.arguments[5], '2026-10-26');
    assert.deepEqual(upload.mock.calls[0]!.arguments[8], { kind: 'valins_all', userId: '123', threadId: 0 });
    assert.equal(await run(11, { text: '/valins_dc bone 2026-10-26' }), 200);
    assert.deepEqual(command.mock.calls[0]!.arguments, ['123', 'dc', 'BONE', '2026-10-26']);
    assert.deepEqual(messages.mock.calls[0]!.arguments, [11, '123', ['chosen report']]);
    preference = { kind: 'valins_dc', scope: 'BONE' };
    assert.equal(await run(12, { document: { file_id: 'file', file_name: 'report.xlsx' } }), 200);
    assert.equal(upload.mock.calls[1]!.arguments[6], 'dc');
    assert.deepEqual(upload.mock.calls[1]!.arguments[8], { kind: 'valins_dc', userId: '123', threadId: 0 });
    preference = { kind: 'unspec', scope: 'SEMUA' };
    assert.equal(await run(13, { document: { file_id: 'file', file_name: 'report.xlsx' } }), 200);
    assert.equal(download.mock.callCount(), 2);
    assert.match(String(messages.mock.calls[1]!.arguments[2]![0]), /Pilihan Anda UNSPEC/);
    preference = { kind: 'unspec', scope: null };
    assert.equal(await run(14, { document: { file_id: 'file', file_name: 'report.csv' } }), 200);
    assert.equal(csv.mock.callCount(), 1);
    assert.equal(csv.mock.calls[0]!.arguments[5], '2026-10-26');
    assert.equal(csv.mock.calls[0]!.arguments[4]!.branches['PARE-PARE'].lis, 101503);
    assert.deepEqual(csv.mock.calls[0]!.arguments[7], { kind: 'unspec', userId: '123', threadId: 0 });
    preference = { kind: 'unspec', scope: 'BONE' };
    assert.equal(await run(15, { document: { file_id: 'file', file_name: 'report.csv' } }), 200);
    assert.equal(csv.mock.calls[1]!.arguments[6], 'SEMUA');
    assert.deepEqual(csv.mock.calls[1]!.arguments[7], { kind: 'unspec', userId: '123', threadId: 0 });
    assert.equal(await run(16, {
      date: Date.parse('2026-11-02T09:00:00+08:00') / 1000,
      document: { file_id: 'file', file_name: 'report.csv' }
    }), 200);
    assert.equal(csv.mock.calls[2]!.arguments[5], '2026-11-01');
    assert.equal(csv.mock.calls[2]!.arguments[4]!.branches['PARE-PARE'].lis, 105932);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('/start and inline buttons use the clicking user, chat and topic', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected'
  });
  const lookups = new Map<number, number>();
  t.mock.method(Store.prototype, 'getJob', async (id: number) => {
    const count = lookups.get(id) ?? 0;
    lookups.set(id, count + 1);
    return count ? { update_id: String(id), chat_id: '-100123', messages: ['prepared'], delivered: 1 } : null;
  });
  const menu = t.mock.method(Store.prototype, 'prepareMenu', async () => {});
  const ack = t.mock.method(Telegram.prototype, 'answerCallback', async () => {});
  const run = async (body: unknown): Promise<number> => {
    let status = 0;
    const response = { setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; } } as unknown as ApiResponse;
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' }, body } as unknown as ApiRequest, response);
    return status;
  };
  const botMessage = { from: { id: 777, is_bot: true }, chat: { id: -100123 }, message_id: 20, date: 1793062800, message_thread_id: 42 };
  try {
    assert.equal(await run({ update_id: 20, message: { ...botMessage, from: { id: 123 }, text: '/start' } }), 200);
    assert.deepEqual(menu.mock.calls[0]!.arguments, [20, '-100123', '123', 42, { type: 'main' }]);
    assert.equal(await run({ update_id: 21, callback_query: { id: 'cb1', from: { id: 456 }, message: botMessage, data: 'menu:valins_all' } }), 200);
    assert.deepEqual(menu.mock.calls[1]!.arguments, [21, '-100123', '456', 42, { type: 'kind', kind: 'valins_all' }]);
    assert.equal(await run({ update_id: 22, callback_query: { id: 'cb2', from: { id: 456 }, message: botMessage, data: 'branch:valins_all:SEMUA:2026-10-27' } }), 200);
    assert.deepEqual(menu.mock.calls[2]!.arguments, [22, '-100123', '456', 42, { type: 'branch', kind: 'valins_all', scope: 'SEMUA', date: '2026-10-27' }]);
    assert.equal(ack.mock.callCount(), 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('photo reply creates a delivery job and retries long-report text without sending the photo again', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: '777:test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected'
  });
  const jobs = new Map<number, Job>();
  const prepare = t.mock.method(Store.prototype, 'prepareMessages', async (id: number, chatId: string, messages: OutgoingMessage[]) => {
    if (!jobs.has(id)) jobs.set(id, { update_id: String(id), chat_id: chatId, messages, delivered: 0 });
  });
  t.mock.method(Store.prototype, 'getJob', async (id: number) => jobs.get(id) ?? null);
  t.mock.method(Store.prototype, 'claim', async (id: number) => jobs.get(id) ?? null);
  t.mock.method(Store.prototype, 'advance', async (id: number, _owner: string, delivered: number) => { jobs.get(id)!.delivered = delivered; });
  t.mock.method(Store.prototype, 'release', async () => {});
  const preferences = t.mock.method(Store.prototype, 'getPreference', async () => { throw new Error('Photo replies must not read upload preferences'); });
  const sends: OutgoingMessage[] = [];
  let failTextOnce = true;
  t.mock.method(Telegram.prototype, 'send', async (_chatId: string, message: OutgoingMessage) => {
    sends.push(message);
    if (typeof message !== 'string' && message.type !== 'photo' && failTextOnce) {
      failTextOnce = false;
      throw new TelegramError(503);
    }
  });
  t.mock.method(console, 'error', () => {});
  const report = '📊 SUMMARY PERFORMANSI UNSPEC – BRANCH PARE-PARE\n\nSALDO (H): 227';
  const message: TelegramMessage = {
    message_id: 100, date: 1793062800, message_thread_id: 42,
    from: { id: 123 }, chat: { id: -100123 }, photo: [{ file_id: 'image', width: 1280, height: 960 }],
    caption: 'caption biasa, bukan tanggal upload',
    reply_to_message: { message_id: 50, date: 1793062700, from: { id: 777, is_bot: true }, chat: { id: -100123 }, text: report }
  };
  const run = async (id: number): Promise<number> => {
    let status = 0;
    const response = { setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; } } as unknown as ApiResponse;
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' }, body: { update_id: id, message } } as unknown as ApiRequest, response);
    return status;
  };
  try {
    assert.equal(await run(100), 200);
    assert.equal(sends.length, 1);
    assert.equal(jobs.get(100)?.delivered, 1);
    const first = sends[0];
    assert.ok(first && typeof first !== 'string' && first.type === 'photo');
    assert.equal(first.caption, report);
    message.reply_to_message!.text = report.padEnd(1100, 'x');
    message.message_id = 101;
    assert.equal(await run(101), 503);
    assert.equal(jobs.get(101)?.delivered, 1);
    assert.equal(await run(101), 200);
    assert.equal(jobs.get(101)?.delivered, 2);
    assert.equal(await run(101), 200);
    assert.equal(sends.filter(outgoing => typeof outgoing !== 'string' && outgoing.type === 'photo').length, 2);
    assert.equal(sends.length, 4);
    assert.equal(prepare.mock.callCount(), 2);
    assert.equal(preferences.mock.callCount(), 0);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('UNSPEC live text/table print bypasses CSV and stale menu dates; retries reuse one frozen report set', async t => {
  const original = { ...process.env };
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: '777:test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected' });
  const now = Math.floor(Date.now() / 1000), date = witaDate(now);
  const snapshot = parseSnapshot('INCIDENT,WORKZONE,SUMMARY,STATUS\nINC1,ANT,[UNSPEC],BACKEND', date);
  const live = { date, fetchedAt: new Date(now * 1000).toISOString(), timestamp: now, snapshot, previous: null };
  const jobs = new Map<number, Job>();
  t.mock.method(Store.prototype, 'getJob', async (id: number) => jobs.get(id) ?? null);
  const latest = t.mock.method(UnspecApi.prototype, 'latest', async () => live);
  const csv = t.mock.method(Telegram.prototype, 'downloadCsv', async () => { throw new Error('CSV must not be downloaded'); });
  const valins = t.mock.method(Store.prototype, 'prepareValinsUpload', async () => { throw new Error('VALINS must not change'); });
  t.mock.method(Telegram.prototype, 'answerCallback', async () => {});
  const prepare = t.mock.method(Store.prototype, 'prepareLiveUnspec', async (id: number, chat: string, _user: string, _thread: number, _scope: unknown, input: LiveUnspecReport, format?: 'text' | 'table') => {
    const messages = format === 'table' ? unspecTableMessages(input.snapshot, input.previous, input.date, input.morning ?? null) : renderReports(input.snapshot, input.previous, input.timestamp, input.date);
    jobs.set(id, { update_id: String(id), chat_id: chat, messages, delivered: messages.length });
  });
  t.mock.method(Store.prototype, 'prepareMessages', async (id: number, chat: string, messages: OutgoingMessage[]) => { jobs.set(id, { update_id: String(id), chat_id: chat, messages, delivered: messages.length }); });
  const run = async (id: number, callback = 'live:unspec:SEMUA') => {
    let status = 0;
    const response = { setHeader() {}, status(code: number) { status = code; return this; }, json() {} } as unknown as ApiResponse;
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' }, body: {
      update_id: id, callback_query: { id: 'callback', from: { id: 456 }, data: callback, message: {
        message_id: 20, date: 1, from: { id: 777, is_bot: true }, chat: { id: -100123 }, message_thread_id: 42
      } }
    } } as unknown as ApiRequest, response);
    return status;
  };
  try {
    assert.equal(await run(600), 200); assert.equal(await run(600), 200);
    assert.equal(latest.mock.callCount(), 1);
    assert.deepEqual(prepare.mock.calls[0]!.arguments.slice(0, 5), [600, '-100123', '456', 42, 'SEMUA']);
    assert.equal(prepare.mock.calls[0]!.arguments[5]!.date, date);
    assert.equal(jobs.get(600)!.messages.length, 4);
    assert.deepEqual(jobs.get(600)!.messages, renderReports(snapshot, null, now, date));
    assert.equal(csv.mock.callCount(), 0);assert.equal(valins.mock.callCount(), 0);
    assert.equal(await run(602, 'table:unspec:live'), 200);
    assert.equal(await run(602, 'table:unspec:live'), 200);
    assert.equal(latest.mock.callCount(), 2);
    assert.equal(prepare.mock.calls[1]!.arguments[6], 'table');
    const table = jobs.get(602)!.messages[0];
    assert.ok(table && typeof table !== 'string' && table.type === 'text');
    assert.equal(table.parse_mode, 'HTML');
    assert.ok(table.text.includes('<pre>') && table.text.includes('SALDO'));
    latest.mock.mockImplementation(async (_timeout, requestId) => { throw new UnspecPendingError(requestId!); });
    assert.equal(await run(603), 503);
    assert.equal(jobs.has(603), false, 'pending API requests must not be turned into a permanent error message');
    const pendingRequestId = latest.mock.calls.at(-1)!.arguments[1];
    latest.mock.mockImplementation(async () => live);
    assert.equal(await run(603), 200);
    assert.equal(latest.mock.calls.at(-1)!.arguments[1], pendingRequestId, 'retry resumes the same web request');
    latest.mock.mockImplementation(async () => { throw new InputError('API sementara gagal.'); });
    assert.equal(await run(601), 200);
    assert.equal(prepare.mock.callCount(), 3);
    assert.match(String(jobs.get(601)!.messages[0]), /API sementara gagal/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('permanent Telegram delivery failures are acknowledged; rate limits and outages remain retryable', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: '777:test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected'
  });
  const jobs = new Map<number, Job>();
  const errors = [new TelegramError(403), new TelegramError(400, undefined, -100999), new TelegramError(429, 10), new TelegramError(503)];
  t.mock.method(Store.prototype, 'getJob', async (id: number) => jobs.get(id) ?? null);
  t.mock.method(Store.prototype, 'claim', async (id: number) => jobs.get(id) ?? null);
  const failed = t.mock.method(Store.prototype, 'fail', async (id: number, _owner: string, _code: number, _reason: string) => {
    jobs.get(id)!.delivered = jobs.get(id)!.messages.length;
  });
  const released = t.mock.method(Store.prototype, 'release', async () => {});
  const advance = t.mock.method(Store.prototype, 'advance', async () => {});
  t.mock.method(Telegram.prototype, 'send', async () => { throw errors.shift(); });
  t.mock.method(console, 'error', () => {});
  try {
    const statuses: number[] = [];
    for (let index = 0; index < 4; index++) {
      const id = 300 + index;
      jobs.set(id, { update_id: String(id), chat_id: '-999', messages: ['pending'], delivered: 0 });
      let status = 0;
      const response = { setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; } } as unknown as ApiResponse;
      await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' }, body: {
        update_id: id, message: { message_id: id, date: 1793062800, from: { id: 123 }, chat: { id: -999 }, text: '/start' }
      } } as unknown as ApiRequest, response);
      statuses.push(status);
    }
    assert.deepEqual(statuses, [200, 200, 503, 503]);
    assert.equal(failed.mock.callCount(), 2);
    assert.equal(failed.mock.calls[0]!.arguments[2], 403);
    assert.equal(failed.mock.calls[1]!.arguments[3], 'group_migrated');
    assert.equal(jobs.get(300)!.delivered, 1);
    assert.equal(jobs.get(302)!.delivered, 0);
    assert.equal(released.mock.callCount(), 4);
    assert.equal(advance.mock.callCount(), 0);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
