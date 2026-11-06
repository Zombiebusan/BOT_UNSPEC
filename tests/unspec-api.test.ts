import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER } from '../src/master.js';
import { InputError, parseSnapshot, previousDate, renderReports, witaDate } from '../src/report.js';
import { parseLiveUnspec, UnspecApi } from '../src/unspec-api.js';
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

test('H-1 remains the exact previous WITA day across year and LIS cutoff', () => {
  const newYear = Date.parse('2026-12-31T16:01:00Z');
  const live = parseLiveUnspec(payload(newYear), newYear);
  assert.equal(live.date, '2027-01-01');
  const cutoff = Date.parse('2026-10-31T16:01:00Z');
  const changed = parseLiveUnspec(payload(cutoff), cutoff);
  assert.equal(changed.snapshot.branches.MAKASSAR.lis, 155754);
  assert.equal(changed.previous!.branches.MAKASSAR.lis, 152298);
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
