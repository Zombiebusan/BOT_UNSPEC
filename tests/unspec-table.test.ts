import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER } from '../src/master.js';
import { snapshotFromWorkzoneCounts } from '../src/report.js';
import { buildUnspecTableRows, renderUnspecTableText, unspecTableMessage } from '../src/unspec-table.js';
import { branchMenu, liveUnspecMenu, parseMenuAction, selectedUnspecTableMenu } from '../src/menu.js';

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
});

test('renderer preserves merged headers, aligned table borders and Telegram monospace text', () => {
  const table = renderUnspecTableText(current, previous);
  for (const label of ['BRANCH', 'SALDO', 'H-1', 'TARGET', 'GAP', 'REAL', 'ACH', 'SULBAGSEL', '100,00%']) assert.ok(table.includes(label));
  assert.equal(new Set(table.split('\n').map(line => line.length)).size, 1, 'all table lines must have equal width');
  const message = unspecTableMessage(current, previous, '2026-11-05');
  assert.equal(message.type, 'text');
  assert.equal(message.parse_mode, 'HTML');
  assert.ok(message.text.includes('<pre>'+table+'</pre>'));
  assert.ok(message.text.length < 4096);
  assert.match(message.text, /H-1: 2026-11-04/);
  assert.ok(!('upload' in message));
});

test('large balances expand columns without breaking alignment or Telegram length limit', () => {
  const large = snapshot({ ANT: 100000 });
  const table = renderUnspecTableText(large, large);
  assert.equal(new Set(table.split('\n').map(line => line.length)).size, 1);
  assert.ok(table.includes('100.000'));
  assert.ok(unspecTableMessage(large, large, '2026-11-05').text.length < 4096);
});

test('table button is immediately below print-all for UNSPEC only, with live and archive callbacks', () => {
  const live = liveUnspecMenu().reply_markup!.inline_keyboard;
  const all = live.findIndex(row => row.some(button => button.callback_data === 'live:unspec:SEMUA'));
  assert.equal(live[all + 1]![0]!.callback_data, 'table:unspec:live');
  assert.deepEqual(parseMenuAction('table:unspec:live'), { type: 'table', kind: 'unspec' });
  assert.deepEqual(parseMenuAction('table:unspec:2026-11-05'), { type: 'table', kind: 'unspec', date: '2026-11-05' });
  assert.throws(() => parseMenuAction('table:valins_all:2026-11-05'));
  assert.throws(() => parseMenuAction('table:unspec:2026-02-30'));
  assert.ok(!branchMenu('valins_all', '2026-11-05').reply_markup!.inline_keyboard.flat().some(button => button.callback_data.startsWith('table:')));
  assert.equal(selectedUnspecTableMenu('2026-11-05', true).reply_markup!.inline_keyboard[0]![0]!.callback_data, 'table:unspec:live');
});
