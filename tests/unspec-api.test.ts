import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER } from '../src/master.js';
import { InputError, parseSnapshot, previousDate, renderReports, witaDate } from '../src/report.js';
import { parseLiveUnspec, UnspecApi, UnspecPendingError } from '../src/unspec-api.js';
import { liveUnspecMenu, parseMenuAction, selectedLiveUnspecMenu } from '../src/menu.js';

const counts = (value = 0): Record<string, number> => Object.fromEntries(Object.keys(MASTER).map(code => [code, code === 'ANT' ? value : 0]));
function payload(now = Date.now()) {
  const date = witaDate(now / 1000);
  return { version: 1, complete: true, scope: 'SULBAGSEL', cohort: 'PROACTIVE_UNSPEC', date, fetchedAt: new Date(now).toISOString(),
    current: { total: 2, countsByWorkzone: counts(2) }, previous: { date: previousDate(date), total: 3, countsByWorkzone: counts(3) } };
}

test('API and equivalent CSV produce exactly the same complete four UNSPEC reports', () => {
  const now = Date.parse('2026-11-05T06:00:00Z');
  const live = parseLiveUnspec(payload(now), now);
  const csv = parseSnapshot('INCIDENT,WORKZONE,SUMMARY,STATUS\nINC1,ANT,[UNSPEC],BACKEND\nINC2,ANT,[UNSPEC],BACKEND', live.date);
  const old = parseSnapshot('INCIDENT,WORKZONE,SUMMARY,STATUS\nINC1,ANT,[UNSPEC],BACKEND\nINC2,ANT,[UNSPEC],BACKEND\nINC3,ANT,[UNSPEC],BACKEND', previousDate(live.date));
  assert.deepEqual(live.snapshot, csv);
  assert.deepEqual(live.previous, old);
  assert.deepEqual(renderReports(live.snapshot, live.previous, live.timestamp, live.date), renderReports(csv, old, live.timestamp, live.date));
  assert.equal(renderReports(live.snapshot, live.previous, live.timestamp, live.date).length, 4);
});

test('valid zero balances and missing H-1 are supported; incomplete/stale data is rejected', () => {
  const now = Date.parse('2026-11-05T06:00:00Z');
  const empty = { ...payload(now), current: { total: 0, countsByWorkzone: counts() }, previous: null };
  assert.equal(parseLiveUnspec(empty, now).snapshot.totalRows, 0);
  assert.equal(parseLiveUnspec(empty, now).previous, null);
  for (const modify of [
    (p: any) => { p.complete = false; },
    (p: any) => { p.scope = 'SEMUA'; },
    (p: any) => { p.cohort = 'LEGACY'; },
    (p: any) => { p.fetchedAt = '2026-11-04T06:00:00Z'; },
    (p: any) => { p.date = '2026-11-04'; },
    (p: any) => { p.previous.date = '2026-11-03'; },
    (p: any) => { delete p.current.countsByWorkzone.ANT; },
    (p: any) => { p.current.countsByWorkzone.PKA = 1; },
    (p: any) => { p.current.countsByWorkzone.ANT = -1; },
    (p: any) => { p.current.countsByWorkzone.ANT = '2'; },
    (p: any) => { p.current.total = 5; },
  ]) {
    const input = structuredClone(payload(now)); modify(input);
    assert.throws(() => parseLiveUnspec(input, now), InputError);
  }
});

test('live UNSPEC date rolls over at 08:00 WITA, including year and LIS cutoffs', () => {
  const newYear = Date.parse('2026-12-31T16:01:00Z');
  const live = parseLiveUnspec(payload(newYear), newYear);
  assert.equal(live.date, '2026-12-31');assert.equal(live.previous, null);
  const cutoff = Date.parse('2026-10-31T16:01:00Z');
  const changed = parseLiveUnspec(payload(cutoff), cutoff);
  assert.equal(changed.date, '2026-10-31');assert.equal(changed.snapshot.branches.MAKASSAR.lis, 152298);assert.equal(changed.previous, null);
  const after = Date.parse('2026-11-01T00:01:00Z'), started = parseLiveUnspec(payload(after), after);
  assert.equal(started.date, '2026-11-01');assert.equal(started.snapshot.branches.MAKASSAR.lis, 155754);
  assert.equal(started.previous!.branches.MAKASSAR.lis, 152298);
});

test('live print menus require no upload and no historical date in callbacks', () => {
  const choices = liveUnspecMenu().reply_markup!.inline_keyboard.flat();
  assert.deepEqual(choices.slice(0, 5).map(button => parseMenuAction(button.callback_data)),
    ['PARE-PARE', 'BONE', 'KENDARI', 'MAKASSAR', 'SEMUA'].map(scope => ({ type: 'live', kind: 'unspec', scope })));
  const selected = selectedLiveUnspecMenu('BONE', '2026-11-05', '2026-11-05T06:00:00Z', true);
  assert.equal(selected.reply_markup!.inline_keyboard[0]![0]!.callback_data, 'live:unspec:BONE');
  assert.deepEqual(parseMenuAction('upload:unspec'), { type: 'upload', kind: 'unspec' });
  assert.deepEqual(parseMenuAction('live:unspec:menu'), { type: 'live-menu', kind: 'unspec' });
  assert.throws(() => parseMenuAction('live:valins_dc:BONE'), InputError);
});

test('API client uses POST bearer auth and safely handles upstream failures', async t => {
  const token = 'integration-test-token-not-a-real-secret';
  let mode = 200;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    if (mode === -1) throw new Error(`Network failure ${token}`);
    return mode === 200 ? Response.json(payload()) : new Response('not returned to the user', { status: mode });
  });
  const api = new UnspecApi({ unspecApiUrl: 'https://example.test/api/bot/unspec', unspecApiToken: token });
  assert.equal((await api.latest()).snapshot.totalRows, 2);
  for (mode of [401, 409, 429, 503, 530, -1]) await assert.rejects(api.latest(), error => error instanceof InputError && !error.message.includes(token));
  assert.equal(fetchMock.mock.callCount(), 7);
  await assert.rejects(new UnspecApi({}).latest(), InputError);
});

test('asynchronous API is polled by stable request ID and completed result is validated', async t => {
  const requestId = 'tg-integration-12345', now = Date.now();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls++;
    if (calls === 1) {
      assert.equal(init?.method, 'POST');assert.deepEqual(JSON.parse(String(init?.body)), { requestId });
      return Response.json({ requestId, status: 'pending' }, { status: 202, headers: { 'Retry-After': '0' } });
    }
    assert.equal(init?.method, 'GET');assert.equal(new URL(url).searchParams.get('requestId'), requestId);
    return Response.json({ ...payload(now), requestId, requestedAt: new Date(now - 1000).toISOString(), completedAt: new Date(now + 1).toISOString() });
  });
  const result = await new UnspecApi({ unspecApiUrl: 'https://example.test/api/bot/unspec', unspecApiToken: 'test-token' }).latest(1000, requestId);
  assert.equal(result.snapshot.totalRows, 2);assert.equal(calls, 2);
});
test('pending request can resume on webhook retry instead of creating an error report', async t => {
  const requestId = 'tg-integration-12345';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ requestId, status: 'pending' }, { status: 202, headers: { 'Retry-After': '10' } }));
  await assert.rejects(new UnspecApi({ unspecApiUrl: 'https://example.test/api/bot/unspec', unspecApiToken: 'test-token' }).latest(100, requestId),
    error => error instanceof UnspecPendingError && error.requestId === requestId);
});
test('delayed delivery accepts only a matching completed job, not an arbitrary stale snapshot', () => {
  const now = Date.parse('2026-11-06T02:00:00Z'), captured = now - 5 * 60_000;
  const completed = { ...payload(captured), requestId: 'tg-integration-12345', requestedAt: new Date(captured - 10000).toISOString(), completedAt: new Date(captured + 10000).toISOString() };
  assert.throws(() => parseLiveUnspec(completed, now), InputError);
  assert.equal(parseLiveUnspec(completed, now, completed.requestId).snapshot.totalRows, 2);
  assert.throws(() => parseLiveUnspec(completed, now, 'tg-different-12345'), InputError);
});
test('specific API failures are actionable without echoing arbitrary remote text', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'UPSTREAM_TIMEOUT', error: 'arbitrary remote text must not be echoed' }, { status: 504 }));
  await assert.rejects(new UnspecApi({ unspecApiUrl: 'https://example.test/api/bot/unspec', unspecApiToken: 'test-token' }).latest(),
    error => error instanceof InputError && /MONICA terlalu lama/.test(error.message) && !error.message.includes('arbitrary'));
});

test('08:00 baseline is parsed separately and rejects late, future, or wrong-day captures', () => {
  const now = Date.parse('2026-11-05T06:00:00Z');
  const morning = { date: '2026-11-05', scheduledTime: '08:00', timeZone: 'Asia/Makassar', capturedAt: '2026-11-05T00:01:00Z', total: 3, countsByWorkzone: counts(3) };
  const parsed = parseLiveUnspec({ ...payload(now), morning }, now);
  assert.equal(parsed.morning!.snapshot!.totalRows, 3);
  assert.equal(parsed.snapshot.totalRows, 2);assert.equal(parsed.previous!.totalRows, 3);
  assert.equal(parseLiveUnspec(payload(now), now).morning, null);
  for (const patch of [ { date: '2026-11-04' }, { capturedAt: '2026-11-05T03:00:00Z' }, { capturedAt: '2026-11-05T00:05:00Z' }, { timeZone: 'UTC' } ]) {
    assert.throws(() => parseLiveUnspec({ ...payload(now), morning: { ...morning, ...patch } }, now), InputError);
  }
  const before = Date.parse('2026-11-04T23:59:00Z');
  assert.throws(() => parseLiveUnspec({ ...payload(before), morning }, before), InputError);
});
