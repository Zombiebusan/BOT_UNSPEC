import test from 'node:test';
import assert from 'node:assert/strict';
import { BRANCHES } from '../src/master.js';
import { InputError, parseSnapshot as parseSnapshotForDate, previousDate, reconciliation, renderReports, resolveCsvReportDate, resolveReportDate, witaDate } from '../src/report.js';

const csv = (...rows: string[]): string => ['INCIDENT,WORKZONE,SUMMARY,STATUS', ...rows].join('\n');
const timestamp = Date.parse('2026-10-27T09:00:00+08:00') / 1000;
const parseSnapshot = (text: string, date = '2026-10-26') => parseSnapshotForDate(text, date);

test('historical October LIS matches the four dashboard branch totals', () => {
  const snapshot = parseSnapshot(csv('INC1,WON,[UNSPEC],BACKEND'));
  assert.deepEqual(BRANCHES.map(branch => snapshot.branches[branch].lis), [44600, 83681, 152298, 101503]);
  assert.equal(snapshot.branches['PARE-PARE'].saldo, 1);
  assert.equal(snapshot.branches.BONE.saldo, 0);
});

test('November data uses the new LIS for every branch, targets and STO rates', () => {
  const uploadDate = Date.parse('2026-11-02T09:00:00+08:00') / 1000;
  const date = resolveCsvReportDate(undefined, uploadDate);
  assert.equal(date, '2026-11-01');
  const snapshot = parseSnapshot(csv('INC1,MAL,[UNSPEC],BACKEND'), date);
  assert.deepEqual(BRANCHES.map(branch => snapshot.branches[branch].lis), [47534,86141,155754,105932]);
  assert.deepEqual(BRANCHES.map(branch => Math.floor(snapshot.branches[branch].lis / 1000)), [47,86,155,105]);
  assert.equal(snapshot.branches.MAKASSAR.stoLis?.MAL, 710);
  const reports = renderReports(snapshot, null, uploadDate, date);
  assert.match(reports[2]!, /🔴 MAL: 0,14%/);
  assert.match(reports[3]!, /TOTAL LIS: 105\.932/);
  assert.match(reports[3]!, /TARGET SALDO 0,10%: 105\n/);
  assert.equal(parseSnapshotForDate(csv('INC1,WON,[UNSPEC],BACKEND')).branches['PARE-PARE'].lis, 105932);
});

test('month changes and legacy snapshots preserve each saved denominator', () => {
  const previous = parseSnapshot(csv('INC1,MAL,[UNSPEC],BACKEND'), '2026-10-31');
  const current = parseSnapshot(csv('INC1,MAL,[UNSPEC],BACKEND'), '2026-11-01');
  assert.equal(previous.branches.MAKASSAR.lis, 152298);
  assert.equal(current.branches.MAKASSAR.lis, 155754);
  assert.equal(previous.branches.MAKASSAR.stoLis?.MAL, 629);
  assert.match(renderReports(current, previous, timestamp, '2026-11-01')[2]!, /SALDO \(H-1\): 1\n/);
  for (const branch of BRANCHES) delete previous.branches[branch].stoLis;
  // Existing snapshots created before this update may have October LIS saved under a November date.
  const legacy = renderReports(previous, null, timestamp, '2026-11-01')[2]!;
  assert.match(legacy, /TOTAL LIS: 152\.298/);
  assert.match(legacy, /🔴 MAL: 0,16%/);
  assert.throws(() => parseSnapshot(csv('INC1,WON,[UNSPEC],BACKEND'), '2026-11-31'), InputError);
});

test('quoted multiline fields, commas, BOM and semicolon exports parse correctly', () => {
  const snapshot = parseSnapshot('\uFEFFINCIDENT;WORKZONE;SUMMARY;STATUS\r\nINC1;won;"[UNSPEC] teks, dengan\nbaris baru";BACKEND');
  assert.equal(snapshot.branches['PARE-PARE'].stos.WON, 1);
});

test('duplicate incident keeps its last row, including changed workzone', () => {
  const snapshot = parseSnapshot(csv('INC1,WON,[UNSPEC],BACKEND', 'INC1,WTP,[UNSPEC],BACKEND'));
  assert.equal(snapshot.duplicateRows, 1);
  assert.equal(snapshot.branches['PARE-PARE'].saldo, 0);
  assert.equal(snapshot.branches.BONE.saldo, 1);
});

test('known outside STO is excluded while non-UNSPEC and closed tickets are filtered', () => {
  const snapshot = parseSnapshot(csv(
    'INC1,WON,[UNSPEC],BACKEND', 'INC2,PKA,[UNSPEC],BACKEND',
    'INC3,WTP,OTHER,BACKEND', 'INC4,WTP,[UNSPEC],CLOSED'
  ));
  assert.equal(snapshot.excludedRows, 1);
  assert.equal(snapshot.filteredRows, 2);
  assert.match(reconciliation(snapshot)!, /1 tiket di luar 4 branch/);
  assert.equal(snapshot.branches.BONE.saldo, 0);
});

test('unknown STO, malformed CSV, blank required cells, or missing headers are rejected', () => {
  for (const input of [
    csv('INC1,UNKNOWN,[UNSPEC],BACKEND'),
    csv('INC1,WON,"unterminated,BACKEND'),
    csv('INC1,,[UNSPEC],BACKEND'),
    'INCIDENT,SUMMARY\nINC1,[UNSPEC]',
    'INCIDENT,WORKZONE,WORKZONE\nINC1,WON,WTP',
    'INCIDENT,WORKZONE\n'
  ]) assert.throws(() => parseSnapshot(input), InputError);
});

test('old REPORTED DATE never prevents a current upload from being reported', () => {
  const snapshot = parseSnapshot('INCIDENT,WORKZONE,REPORTED DATE\nINC1,WON,2020-01-01 00:00:00');
  const reports = renderReports(snapshot, null, timestamp);
  assert.equal(reports.length, 4);
  assert.doesNotMatch(reports[3]!, /📅|🕒 Diupload:/);
  assert.match(reports[3]!, /SALDO \(H\): 1\n/);
  assert.match(reports[3]!, /SALDO \(H-1\): Belum tersedia/);
  assert.match(reports[3]!, /TOTAL LIS: 101\.503/);
  assert.match(reports[3]!, /TARGET SALDO 0,10%: 101\n/);
  assert.match(reports[3]!, /🟢 SID: 0,00%/);
  assert.ok(reports.every(report => report.length < 4096));
});

test('target status uses full precision even when displayed percentages are equal', () => {
  // MAL has LIS 629; 1 ticket is already over target. WON has LIS 3347;
  // 3 tickets are green, 4 are red.
  const snapshot = parseSnapshot(csv(
    'I1,MAL,[UNSPEC],BACKEND',
    'I2,WON,[UNSPEC],BACKEND', 'I3,WON,[UNSPEC],BACKEND',
    'I4,WON,[UNSPEC],BACKEND', 'I5,WON,[UNSPEC],BACKEND'
  ));
  const report = renderReports(snapshot, null, timestamp);
  assert.match(report[2]!, /🔴 MAL: 0,16% \(Tertinggi\)/);
  assert.match(report[3]!, /🔴 WON: 0,12% \(Tertinggi\)/);
  snapshot.branches['PARE-PARE'].stos.WON = 3;
  snapshot.branches['PARE-PARE'].saldo = 3;
  assert.match(renderReports(snapshot, null, timestamp)[3]!, /🟢 WON: 0,09%/);
  // Just above the branch target still displays 0,10%, but must be red.
  snapshot.branches['PARE-PARE'].saldo = 102;
  assert.match(renderReports(snapshot, null, timestamp)[3]!, /🔴 0,10% \(Di atas target\)/);
});

test('growth compares branch ratios against previous snapshot and includes zero balances', () => {
  const old = parseSnapshot(csv('I1,WON,[UNSPEC],BACKEND'));
  const current = parseSnapshot(csv('I2,WTP,[UNSPEC],BACKEND'));
  const reports = renderReports(current, old, timestamp);
  assert.match(reports[0]!, /SALDO \(H-1\): 0\n/);
  assert.match(reports[0]!, /\(Memburuk\)/);
  assert.match(reports[1]!, /0,00% \(Tetap\)/);
  assert.match(reports[3]!, /\(Membaik\)/);
});

test('WITA midnight and month/year boundaries choose exact previous calendar day', () => {
  assert.equal(witaDate(Date.parse('2026-10-27T15:59:59Z') / 1000), '2026-10-27');
  assert.equal(witaDate(Date.parse('2026-10-27T16:00:00Z') / 1000), '2026-10-28');
  assert.equal(previousDate('2026-11-01'), '2026-10-31');
  assert.equal(previousDate('2027-01-01'), '2026-12-31');
  assert.equal(previousDate('2028-03-01'), '2028-02-29');
});

test('caption dates separate historical exports uploaded on the same day', () => {
  assert.equal(resolveReportDate(undefined, timestamp), '2026-10-27');
  assert.equal(resolveReportDate('  ', timestamp), '2026-10-27');
  assert.equal(resolveReportDate('tanggal=2026-10-25', timestamp), '2026-10-25');
  assert.equal(resolveReportDate('Tanggal = 2026-10-26', timestamp), '2026-10-26');
  assert.equal(resolveReportDate('2026-10-25', timestamp), '2026-10-25');
  assert.equal(resolveReportDate(' 2026-10-26 ', timestamp), '2026-10-26');
  for (const caption of ['tanggal=2026-02-30', 'tanggal=25-10-2026', 'tanggal=', 'tanggal=2026-10-25 extra', '2026-02-30', '25-10-2026', '2026-10-25 extra']) {
    assert.throws(() => resolveReportDate(caption, timestamp), InputError);
  }
  const snapshot = parseSnapshot(csv('I1,WON,[UNSPEC],BACKEND'));
  const report = renderReports(snapshot, null, timestamp, '2026-10-25')[3]!;
  assert.doesNotMatch(report, /📅|🕒 Diupload:/);
});

test('routine CSV uploaded on the 27th means data 26 / comparison 25; next upload day advances both dates', () => {
  const upload27 = Date.parse('2026-10-27T09:00:00+08:00') / 1000;
  const upload28 = Date.parse('2026-10-28T09:00:00+08:00') / 1000;
  assert.equal(resolveCsvReportDate(undefined, upload27), '2026-10-26');
  assert.equal(previousDate(resolveCsvReportDate(undefined, upload27)), '2026-10-25');
  assert.equal(resolveCsvReportDate(' ', upload28), '2026-10-27');
  assert.equal(previousDate(resolveCsvReportDate(undefined, upload28)), '2026-10-26');
  assert.equal(resolveCsvReportDate(undefined, upload27 + 3600), '2026-10-26');
  assert.equal(resolveCsvReportDate('2026-10-25', upload27), '2026-10-25');
  assert.equal(resolveCsvReportDate('tanggal=2026-10-27', upload27), '2026-10-27');
  assert.throws(() => resolveCsvReportDate('2026-02-30', upload27), InputError);
  assert.equal(resolveCsvReportDate(undefined, Date.parse('2026-10-27T15:59:59Z') / 1000), '2026-10-26');
  assert.equal(resolveCsvReportDate(undefined, Date.parse('2026-10-27T16:00:00Z') / 1000), '2026-10-27');
  assert.equal(resolveCsvReportDate(undefined, Date.parse('2027-01-01T00:00:00+08:00') / 1000), '2026-12-31');
});
