import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MASTER } from '../src/master.js';
import { snapshotFromWorkzoneCounts } from '../src/report.js';
import { fetchVisualHistory, renderVisualPhotos, validateVisualHistory, visualSeries, visualSvg, VISUAL_KEYS, type VisualHistory } from '../src/unspec-visuals.js';
import { liveUnspecMenu, parseMenuAction, visualUnspecMenu } from '../src/menu.js';
import type { LiveUnspecReport } from '../src/unspec-api.js';

const counts = Object.fromEntries(Object.keys(MASTER).map((code, index) => [code, index % 4]));
const customers = Object.fromEntries(Object.entries(MASTER).map(([code, sto]) => [code, sto.lis]));
const live: LiveUnspecReport = { date: '2026-11-11', fetchedAt: '2026-11-11T01:00:00Z', timestamp: Date.parse('2026-11-11T01:00:00Z') / 1000,
  snapshot: snapshotFromWorkzoneCounts(counts, '2026-11-11'), previous: null };
const history: VisualHistory = { version: 1, requestId: 'visual-request-123', date: live.date, fetchedAt: live.fetchedAt,
  daily: { '2026-11-09': { ...counts, ANT: 4 }, '2026-11-10': { ...counts, ANT: 3 }, '2026-11-11': { ...counts, ANT: 999 } },
  monthly: { '2026-07': { saldo: counts, customers }, '2026-10': { saldo: counts, customers }, '2026-11': { saldo: { ...counts, ANT: 999 }, customers } },
  customers, imjas: { weight: 6, branch: { BONE: 10_000_000, KENDARI: 20_000_000, MAKASSAR: 30_000_000, 'PARE-PARE': 40_000_000 }, regionalReported: 100_000_000 } };

test('menu visual only recognizes supported callbacks and keeps current print choices', () => {
  assert.deepEqual(parseMenuAction('visual:menu'), { type: 'visual-menu' });
  assert.deepEqual(parseMenuAction('visual:all'), { type: 'visual', key: 'all' });
  for (const key of VISUAL_KEYS) assert.deepEqual(parseMenuAction('visual:'+key), { type: 'visual', key });
  assert.throws(() => parseMenuAction('visual:other'));
  assert.ok(liveUnspecMenu().reply_markup?.inline_keyboard.flat().some(button => button.callback_data === 'visual:menu'));
  assert.equal(visualUnspecMenu().reply_markup?.inline_keyboard.length, 9);
});

test('visual series use actual saved dates, frozen API counts and monthly customer basis', () => {
  const frozen = validateVisualHistory(structuredClone(history), live, history.requestId);
  const daily = visualSeries(frozen, live).daily();
  assert.deepEqual(daily.map(point => point.date), ['2026-11-09', '2026-11-10', '2026-11-11']);
  assert.equal(daily.at(-1)?.count, live.snapshot.totalRows);
  assert.equal(visualSeries(frozen, live).monthly('MAKASSAR').at(-1)?.count, live.snapshot.branches.MAKASSAR.saldo);
  assert.throws(() => validateVisualHistory({ ...history, requestId: 'foreign' }, live, history.requestId));
  assert.throws(() => validateVisualHistory({ ...history, customers: { ANT: -1 } }, live, history.requestId));
});

test('visual endpoint client sends bearer auth and validates the request id and frozen data', async t => {
  const mocked = t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    assert.equal(new URL(input.toString()).pathname, '/api/bot/visuals');
    assert.equal(new URL(input.toString()).searchParams.get('requestId'), history.requestId);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret');
    return Response.json(history);
  });
  const result = await fetchVisualHistory({ unspecApiUrl: 'https://dashboard.test/api/bot/unspec', unspecApiToken: 'secret' }, live, history.requestId);
  assert.equal(result.daily[live.date]?.ANT, counts.ANT);
  assert.equal(mocked.mock.callCount(), 1);
});

test('seven captures contain real labelled series, valid PNGs and matching captions', async () => {
  const frozen = validateVisualHistory(structuredClone(history), live, history.requestId);
  for (const key of VISUAL_KEYS) {
    const svg = visualSvg(key, frozen, live);
    assert.ok(svg.includes(live.date));
    if (key === 'daily') assert.ok(svg.includes('2026-11-09') === false && svg.includes('TREN HARIAN'));
    const photos = await renderVisualPhotos(frozen, live, [key]);
    assert.equal(photos.length, 1);
    assert.match(photos[0]!.caption!, /2026-11-11/);
    const png = Buffer.from(photos[0]!.upload!.base64, 'base64');
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, 'png');assert.equal(meta.width, 1500);
    assert.ok(png.length < 10 * 1024 * 1024);
  }
});
