import test from 'node:test';
import assert from 'node:assert/strict';
import { branchMenu, mainMenu, parseMenuAction, REPORT_TYPES, selectedMenu, uploadPrompt } from '../src/menu.js';
import { InputError } from '../src/report.js';
import { selectUnspecReports } from '../src/store.js';

test('main menu has four features and every branch menu has all five print choices', () => {
  const features = mainMenu().reply_markup!.inline_keyboard.flat();
  assert.equal(features.length, 4);
  assert.deepEqual(features.map(button => parseMenuAction(button.callback_data)), REPORT_TYPES.map(kind => ({ type: 'kind', kind })));
  for (const kind of REPORT_TYPES) {
    const buttons = branchMenu(kind, '2026-10-27').reply_markup!.inline_keyboard.flat();
    assert.deepEqual(buttons.slice(0, 5).map(button => parseMenuAction(button.callback_data)),
      ['PARE-PARE','BONE','KENDARI','MAKASSAR','SEMUA'].map(scope => ({ type: 'branch', kind, scope, date: '2026-10-27' })));
    assert.deepEqual(parseMenuAction(buttons[5]!.callback_data), { type: 'main' });
    assert.ok(buttons.every(button => Buffer.byteLength(button.callback_data) <= 64));
  }
});

test('feature selection asks for a file, then dated print menus preserve the uploaded date', () => {
  for (const kind of REPORT_TYPES) {
    const prompt = uploadPrompt(kind);
    assert.match(prompt.text, /Silakan upload file/);
    assert.ok(prompt.reply_markup!.inline_keyboard.flat().every(button => !button.callback_data.startsWith('branch:')));
  }
  const menu = selectedMenu('valins_dc', 'BONE', '2026-10-27');
  assert.match(menu.text, /VALINS DC — BONE/);
  assert.match(menu.text, /Tanggal data: 2026-10-27/);
  const buttons = menu.reply_markup!.inline_keyboard.flat();
  assert.deepEqual(parseMenuAction(buttons[0]!.callback_data), { type: 'print', kind: 'valins_dc', scope: 'BONE', date: '2026-10-27' });
  assert.deepEqual(parseMenuAction(buttons[1]!.callback_data), { type: 'branches', kind: 'valins_dc', date: '2026-10-27' });
  assert.deepEqual(parseMenuAction(buttons[2]!.callback_data), { type: 'kind', kind: 'valins_dc' });
  assert.deepEqual(parseMenuAction(buttons[3]!.callback_data), { type: 'main' });
  assert.match(uploadPrompt('unspec').text, /CSV \(\.csv\)/);
  assert.match(branchMenu('unspec', '2026-10-27', true).text, /H-1: 2026-10-26 \(tersedia\)/);
});

test('malformed callback choices are rejected and UNSPEC filtering uses branch order', () => {
  for (const input of ['menu:wrong', 'branch:unspec:PALU', 'branch:valins_dc:', 'menu:unspec:extra', 'print:unspec:BONE:extra', 'branch:unspec:BONE:2026-02-30']) {
    assert.throws(() => parseMenuAction(input), InputError);
  }
  const reports = ['bone','kendari','makassar','pare-pare'];
  assert.deepEqual(selectUnspecReports(reports, 'BONE'), ['bone']);
  assert.deepEqual(selectUnspecReports(reports, 'PARE-PARE'), ['pare-pare']);
  assert.deepEqual(selectUnspecReports(reports, 'SEMUA'), reports);
});
