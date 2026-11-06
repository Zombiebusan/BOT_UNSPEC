import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER } from '../src/master.js';
import { snapshotFromWorkzoneCounts } from '../src/report.js';
import { areaBalances, baselineFromReportJob, baselineFromSnapshot, chooseOpeningBaseline, morningBalances, unspecOperationalDate } from '../src/morning-baseline.js';
import { unspecTableMessages } from '../src/unspec-table.js';
import { selectedUnspecTableMenu } from '../src/menu.js';

const make = (count: number) => snapshotFromWorkzoneCounts(Object.fromEntries(Object.keys(MASTER).map(code => [code, code === 'ANT' ? count : 0])), '2026-11-06');
test('operational day lasts from 08:00 through 07:59 next calendar day', () => {
  for (const [time, date] of [
    ['2026-11-06T00:00:00+08:00','2026-11-05'],['2026-11-06T07:59:59+08:00','2026-11-05'],
    ['2026-11-06T08:00:00+08:00','2026-11-06'],['2026-11-07T07:59:59+08:00','2026-11-06'],
    ['2027-01-01T07:59:59+08:00','2026-12-31'],['2027-01-01T08:00:00+08:00','2027-01-01'],
  ] as const) assert.equal(unspecOperationalDate(Date.parse(time)/1000), date);
});
test('earliest available opening remains valid after midnight and is labeled with actual time', () => {
  const old = baselineFromSnapshot(make(18), '2026-11-06T02:38:00Z');
  const later = baselineFromSnapshot(make(17), '2026-11-06T08:00:00Z');
  const selected = chooseOpeningBaseline('2026-11-06',[later,old],'2026-11-06T23:00:00Z')!;
  assert.equal(selected.capturedAt,old.capturedAt);assert.equal(Object.values(areaBalances(morningBalances(selected))).reduce((a,b)=>a+b,0),18);
  const report = unspecTableMessages(make(17),null,'2026-11-06',selected)[0]!;
  assert.match(report.text,/Acuan awal tersedia:/);assert.ok(!report.text.includes('Acuan 08.00:'));
  assert.equal(chooseOpeningBaseline('2026-11-07',[old],'2026-11-07T08:00:00Z'),null);
});
test('complete historical API table can recover exact SA opening counts; CSV and incomplete tables cannot', () => {
  const messages=unspecTableMessages(make(18),null,'2026-11-06').map(message=>({...message,reply_markup:selectedUnspecTableMenu('2026-11-06',true).reply_markup}));
  const baseline=baselineFromReportJob(messages,'2026-11-06T03:00:00Z','2026-11-06')!;
  assert.equal(baseline.serviceAreas!['SA TAMALANREA'],18);
  assert.equal(baseline.source,'report_history');
  const csv=messages.map(message=>({...message,reply_markup:selectedUnspecTableMenu('2026-11-06',false).reply_markup}));
  assert.equal(baselineFromReportJob(csv,'2026-11-06T03:00:00Z','2026-11-06'),null);
  assert.equal(baselineFromReportJob(messages.map(message=>({...message,text:message.text.replace('SA MAROS','INCOMPLETE')})),'2026-11-06T03:00:00Z','2026-11-06'),null);
});
