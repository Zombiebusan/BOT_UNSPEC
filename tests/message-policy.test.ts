import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBotCommand, reportDocumentKind } from '../src/message-policy.js';

test('only the explicit supported slash commands are recognized', () => {
  for (const text of [undefined, '', 'halo', 'Reload cukup tinggal Sabtu ini', 'UNSPEC', '@reportsulbagsel_bot', 'tolong /help', '/unknown', '/startups', '/start@', 'Snapshot valid sebelumnya tidak diubah.']) assert.equal(parseBotCommand(text), null);
  assert.deepEqual(parseBotCommand('/help'), { command: '/help', args: [] });
  assert.deepEqual(parseBotCommand('/REPORT@Own_Bot 2026-11-06'), { command: '/report', target: 'own_bot', args: ['2026-11-06'] });
  assert.deepEqual(parseBotCommand('/valins_dc bone 2026-11-06'), { command: '/valins_dc', args: ['bone','2026-11-06'] });
});
test('only known report file extensions are candidates for an active upload request', () => {
  assert.equal(reportDocumentKind('report.CSV'), 'csv');assert.equal(reportDocumentKind('report.xlsx'), 'xlsx');
  for (const name of [undefined,'image.png','report.pdf','file.csv.exe','report.xls','notes.txt']) assert.equal(reportDocumentKind(name), null);
});
