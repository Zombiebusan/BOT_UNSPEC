import test from 'node:test';
import assert from 'node:assert/strict';
import { Telegram, TelegramError } from '../src/telegram.js';
import { InputError, MAX_CSV_BYTES } from '../src/report.js';
import { mainMenu } from '../src/menu.js';

test('CSV download uses Telegram getFile then fetches document content', async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return urls.length === 1 ? Response.json({ ok: true, result: { file_path: 'documents/file.csv' } }) :
      new Response('INCIDENT,WORKZONE\nI1,WON');
  });
  const text = await new Telegram('test-token').downloadCsv({ file_id: 'f1', file_name: 'EXPORT.CSV' });
  assert.equal(text, 'INCIDENT,WORKZONE\nI1,WON');
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /getFile$/);
});

test('wrong extension and oversized files fail before downloading', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  const telegram = new Telegram('test-token');
  await assert.rejects(telegram.downloadCsv({ file_id: 'f1', file_name: 'data.xlsx' }), InputError);
  await assert.rejects(telegram.downloadCsv({ file_id: 'f1', file_name: 'data.csv', file_size: MAX_CSV_BYTES + 1 }), InputError);
  assert.equal(fetch.mock.callCount(), 0);
});

test('actual downloaded bytes are capped even without declared file size', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ?
    Response.json({ ok: true, result: { file_path: 'file.csv' } }) : new Response(new Uint8Array(MAX_CSV_BYTES + 1)));
  await assert.rejects(new Telegram('test-token').downloadCsv({ file_id: 'f1', file_name: 'data.csv' }), InputError);
});

test('API rate limit exposes retry timing without leaking token', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ok: false, error_code: 429, parameters: { retry_after: 12 }
  }, { status: 429 }));
  await assert.rejects(new Telegram('secret-token').send('1', 'hello'), (error: unknown) => {
    assert.ok(error instanceof TelegramError);
    assert.equal(error.retryAfter, 12);
    assert.ok(!error.message.includes('secret-token'));
    return true;
  });
});

test('network errors with token-bearing URLs are replaced with safe errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Failed https://api.telegram.org/botsecret-token/getFile'); });
  await assert.rejects(new Telegram('secret-token').send('1', 'hello'), (error: unknown) => {
    assert.ok(error instanceof TelegramError);
    assert.ok(!error.message.includes('secret-token'));
    return true;
  });
});

test('inline keyboard is sent with its message and topic; expired callbacks are acknowledged safely', async t => {
  const payloads: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    payloads.push(JSON.parse(String(options.body)) as Record<string, unknown>);
    return payloads.length === 1 ? Response.json({ ok: true, result: {} }) : Response.json({ ok: false, error_code: 400 }, { status: 400 });
  });
  const telegram = new Telegram('test-token');
  const message = mainMenu();
  await telegram.send('-100123', message, 42);
  assert.deepEqual(payloads[0], { chat_id: '-100123', text: message.text, reply_markup: message.reply_markup, message_thread_id: 42 });
  await telegram.answerCallback('expired');
  assert.deepEqual(payloads[1], { callback_query_id: 'expired' });
});

test('photo and full-text fallback use Telegram reply parameters and preserve the topic', async t => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(options.body)) as Record<string, unknown> });
    return Response.json({ ok: true, result: {} });
  });
  const telegram = new Telegram('test-token');
  const reply = { message_id: 55, allow_sending_without_reply: true };
  await telegram.send('-100123', { type: 'photo', photo: 'telegram-file-id', caption: 'laporan', reply_parameters: reply }, 42);
  await telegram.send('-100123', { text: 'laporan lengkap', reply_parameters: reply }, 42);
  assert.match(calls[0]!.url, /\/sendPhoto$/);
  assert.deepEqual(calls[0]!.body, { chat_id: '-100123', message_thread_id: 42, photo: 'telegram-file-id', caption: 'laporan', reply_parameters: reply });
  assert.match(calls[1]!.url, /\/sendMessage$/);
  assert.deepEqual(calls[1]!.body, { chat_id: '-100123', message_thread_id: 42, text: 'laporan lengkap', reply_parameters: reply });
  assert.equal('protect_content' in calls[0]!.body, false);
});

test('group migration errors retain the destination metadata for recovery', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ok: false, error_code: 400, parameters: { migrate_to_chat_id: -100999 }
  }, { status: 400 }));
  await assert.rejects(new Telegram('test-token').send('-999', 'hello'), (error: unknown) => {
    assert.ok(error instanceof TelegramError);
    assert.equal(error.code, 400);
    assert.equal(error.migrateToChatId, -100999);
    return true;
  });
});
