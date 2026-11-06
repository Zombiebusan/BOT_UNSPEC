import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER } from '../src/master.js';
import { snapshotFromWorkzoneCounts } from '../src/report.js';
import { buildUnspecTableRows, buildUnspecServiceAreaRows, renderUnspecTableText, unspecTableMessages } from '../src/unspec-table.js';
import { branchMenu, liveUnspecMenu, parseMenuAction, selectedUnspecTableMenu } from '../src/menu.js';
import { UNSPEC_SERVICE_AREAS } from '../src/unspec-service-areas.js';

const snapshot = (values: Record<string, number>) => snapshotFromWorkzoneCounts(Object.fromEntries(Object.keys(MASTER).map(code => [code, values[code] || 0])), '2026-11-05');
const current = snapshot({ ANT: 150, BTN: 23, KDR: 97, PRE: 117 });
const previous = snapshot({ ANT: 167, BTN: 23, KDR: 101, PRE: 120 });

test('table follows reference row order, balances, regional rounding and capped achieved', () => {
  const rows = buildUnspecTableRows(current, previous);
  assert.deepEqual(rows.map(row => row.branch), ['MAKASSAR', 'BONE', 'PARE PARE', 'KENDARI', 'SULBAGSEL']);
  assert.deepEqual(rows.map(row => row.h), [150, 23, 117, 97, 387]);
  assert.deepEqual(rows.map(row => row.previous), [167, 23, 120, 101, 411]);
  assert.deepEqual(rows.map(row => row.target), [155, 47, 105, 86, 395]);
  assert.deepEqual(rows.map(row => row.gap), [0, 0, 12, 11, 0]);
  assert.equal(rows[4]!.target, 395, 'regional target is not the sum of individually rounded branch targets');
  assert.equal(rows[4]!.achieved, 100);
  assert.equal(rows[0]!.achieved, 100);
  assert.ok(rows[2]!.achieved < 100);
});

test('zero balances are valid and missing H-1 stays unavailable', () => {
  const empty = snapshot({});
  const rows = buildUnspecTableRows(empty, null);
  assert.ok(rows.every(row => row.h === 0 && row.previous === null && row.real === 0 && row.achieved === 100));
  assert.ok(renderUnspecTableText(empty, null).includes('—'));
  assert.ok(buildUnspecServiceAreaRows(empty, null).every(row => row.previous === null && row.closeHi === null));
});

test('all 50 STOs belong to exactly one Service Area in the supplied order', () => {
  const codes = UNSPEC_SERVICE_AREAS.flatMap(area => [...area.stos]);
  assert.equal(codes.length, 50);
  assert.equal(new Set(codes).size, 50);
  assert.deepEqual([...codes].sort(), Object.keys(MASTER).sort());
  assert.ok(UNSPEC_SERVICE_AREAS.every(area => area.stos.every(code => MASTER[code]!.branch === area.branch)));
  const rows = buildUnspecServiceAreaRows(current, previous);
  assert.equal(rows.length, 26);
  assert.deepEqual(rows.filter(row => row.level === 'sa').map(row => row.serviceArea), UNSPEC_SERVICE_AREAS.map(area => area.label));
  assert.deepEqual(rows.filter(row => row.level === 'branch').map(row => row.branch), ['MAKASSAR', 'BONE', 'PARE PARE', 'KENDARI']);
  assert.deepEqual(rows.filter(row => row.level === 'branch').map(row => row.h), [150, 23, 117, 97]);
  assert.equal(rows[5]!.serviceArea, 'SA MAROS');
  assert.equal(rows[6]!.level, 'branch');
  assert.equal(rows[6]!.branch, 'MAKASSAR');
  assert.equal(rows[9]!.serviceArea, 'SA WAJO');
  assert.equal(rows[10]!.branch, 'BONE');
  const area = rows.find(row => row.serviceArea === 'SA TAMALANREA')!;
  assert.deepEqual([area.h, area.previous, area.target, area.gap, area.closeHi], [150, 167, 20, 130, 17]);
  const regional = rows.at(-1)!;
  assert.deepEqual([regional.h, regional.previous, regional.target, regional.gap, regional.closeHi], [387, 411, 395, 0, 24]);
  const increase = buildUnspecServiceAreaRows(snapshot({ ANT: 200, BTN: 23, KDR: 97, PRE: 117 }), previous);
  assert.equal(increase.find(row => row.serviceArea === 'SA TAMALANREA')!.closeHi, 0);
  assert.equal(increase.at(-1)!.closeHi, 0, 'regional CLOSE HI is the net regional reduction, not a claim of incident closures');
});

test('renderer preserves merged headers, aligned table borders and Telegram monospace text', () => {
  const table = renderUnspecTableText(current, previous);
  for (const label of ['BRANCH', 'SERVICE AREA', 'SALDO', 'H-1', 'TARGET', 'GAP', 'CLOSE HI', 'REAL', 'ACH', 'SULBAGSEL', '100,00%']) assert.ok(table.normalize('NFKC').includes(label));
  assert.ok(table.includes('SULBAGSEL'));
  assert.ok(!/[\u{1D400}-\u{1D7FF}]/u.test(table), 'styled Unicode must not trigger a different font in the total row');
  const lines = table.split('\n');
  const regionalLine = lines.find(line => line.includes('SULBAGSEL'))!;
  const detailLine = lines.find(line => line.includes('SA TAMALANREA'))!;
  const separators = (line: string) => Array.from(line).flatMap((character, index) => character === '│' ? [index] : []);
  assert.deepEqual(separators(regionalLine), separators(detailLine), 'all regional columns must align with the SA columns');
  assert.equal(new Set(table.split('\n').map(line => Array.from(line).length)).size, 1, 'all table lines must have equal visible character counts');
  const messages = unspecTableMessages(current, previous, '2026-11-05');
  assert.equal(messages.length, 1);
  assert.ok(!messages[0]!.text.includes('Bagian'));
  for (const message of messages) {
    assert.equal(message.type, 'text');assert.equal(message.parse_mode, 'HTML');
    assert.ok(message.text.includes('<pre>'));assert.ok(message.text.length <= 4096);
    assert.match(message.text, /H-1: 2026-11-04/);assert.ok(!('upload' in message));
    assert.equal(new Set(message.text.match(/<pre>([\s\S]*)<\/pre>/)![1]!.split('\n').map(line => Array.from(line).length)).size, 1);
  }
  const combined = messages.map(message => message.text).join('\n');
  for (const area of UNSPEC_SERVICE_AREAS) assert.equal(combined.split(area.label).length - 1, 1, 'every SA must appear once in the single report');
  assert.equal(combined.split('│ SULBAGSEL').length - 1, 1);
});

test('large balances expand columns without breaking alignment or Telegram length limit', () => {
  const large = snapshot({ ANT: 100000 });
  const table = renderUnspecTableText(large, large);
  assert.equal(new Set(table.split('\n').map(line => Array.from(line).length)).size, 1);
  assert.ok(table.includes('100.000'));
  const messages = unspecTableMessages(large, large, '2026-11-05');
  assert.equal(messages.length, 1);
  assert.ok(messages[0]!.text.length <= 4096);
  for (const area of UNSPEC_SERVICE_AREAS) assert.ok(messages[0]!.text.includes(area.label));
});

test('table button is immediately below print-all for UNSPEC only, with live and archive callbacks', () => {
  const live = liveUnspecMenu().reply_markup!.inline_keyboard;
  const all = live.findIndex(row => row.some(button => button.callback_data === 'live:unspec:SEMUA'));
  assert.equal(live[all + 1]![0]!.callback_data, 'table:unspec:live');
  assert.equal(live[all + 1]![0]!.text, '📊 SULBAGSEL REPORT');
  assert.deepEqual(parseMenuAction('table:unspec:live'), { type: 'table', kind: 'unspec' });
  assert.deepEqual(parseMenuAction('table:unspec:2026-11-05'), { type: 'table', kind: 'unspec', date: '2026-11-05' });
  assert.throws(() => parseMenuAction('table:valins_all:2026-11-05'));
  assert.throws(() => parseMenuAction('table:unspec:2026-02-30'));
  assert.ok(!branchMenu('valins_all', '2026-11-05').reply_markup!.inline_keyboard.flat().some(button => button.callback_data.startsWith('table:')));
  assert.equal(selectedUnspecTableMenu('2026-11-05', true).reply_markup!.inline_keyboard[0]![0]!.callback_data, 'table:unspec:live');
});
