import test from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData } from 'read-excel-file/node';
import { parseValinsArguments, parseValinsRows, parseValinsWorkbook, renderValinsReports } from '../src/valins.js';
import { InputError } from '../src/report.js';
import { workbookBytes } from './helpers/xlsx.js';

// Aggregate, non-customer values independently transcribed from the supplied Sheet1.
const pareData: [string, number, number, number, number, number, number, number, number, number, number][] = [
  ['MAJ',299,284,0,0,6212,6031,6032,5933,5716,.9510],
  ['MMS',116,110,0,0,2107,2007,2016,1967,1888,.9321],
  ['PLW',177,172,0,0,6140,6023,6032,5890,5703,.9576],
  ['WON',153,148,1,1,4245,4032,4038,3969,3840,.9341],
  ['ENR',115,110,0,0,3505,3406,3406,3346,3229,.9508],
  ['MAK',321,280,3,3,5789,5660,5683,5592,5433,.9616],
  ['RTP',439,425,0,0,9541,9336,9339,9224,8880,.9580],
  ['MAM',734,610,0,0,13625,13113,13145,12945,12553,.9477],
  ['MAS',399,345,1,1,7855,7595,7627,7458,7218,.9480],
  ['MLL',89,74,0,0,2194,2104,2108,2064,1957,.9321],
  ['SRK',248,214,0,0,6616,6404,6408,6376,5388,.8962],
  ['PLP',1038,915,0,0,22278,21733,21765,21472,20919,.9615],
  ['PRE',673,629,0,0,16674,16430,16458,16152,15542,.9613],
  ['PIN',514,496,0,0,11171,10915,10935,10751,10411,.9585],
  ['RPN',108,104,1,1,2452,2374,2377,2344,2165,.9299],
  ['SID',360,342,58,51,9104,8013,8041,7799,7464,.8663],
  ['TTE',1,1,44,2,241,64,64,62,56,.4934]
];

function row(values: (typeof pareData)[number], oldVisit?: number | null, oldDc?: number | null): SheetData[number] {
  const [code,ont,done,changed,omset,inService,qr,dcDone,toUim,success,dcReal] = values;
  const psb = ont ? done / ont : 1, omsetRate = changed ? omset / changed : 1;
  const real = (psb + omsetRate) / 2;
  const previousVisit = oldVisit === undefined ? real : oldVisit;
  const previousDc = oldDc === undefined ? dcReal : oldDc;
  return [null,code,ont,done,ont-done,psb,changed,omset,changed-omset,omsetRate,92.27,real,previousVisit,
    previousVisit === null ? null : real-previousVisit,code,inService,qr,null,dcDone,toUim,success,inService-qr,95,dcReal,previousDc,
    previousDc === null ? null : dcReal-previousDc];
}
function block(code: string, detail: SheetData[number][], total: SheetData[number]): SheetData {
  return [
    [null,'VALINS VISIT ODP (PROV, ASR DAN MAINT)',null,null,null,null,null,null,null,null,null,'TOTAL',null,'GROWTH','VALINS DC QR CODE & SERVICE'],
    [null,'SA / STO','ONT BARU','VALINS PSB','BELUM VALINS','REAL','ONT BERUBAH PORT','VALINS OMSET','BELUM VALINS','REAL','TARGET',null,null,null,'SA / STO','ONT IN SERVICE (ONLINE < 60 HARI','QR CODE VALINS',null,'SUDAH VALINS','VALINS To UIM','SUCCESS UIM','BELUM VALINS','TARGET'],
    [null,null,null,null,null,null,null,null,null,null,null,'H','H-1',null,null,null,null,null,null,null,null,null,null,'H','H-1'],
    // SA subtotals are intentionally not counted as STO.
    [null,`SA ${code}`], ...detail, total
  ];
}
function fixture(): SheetData {
  const output: SheetData = [];
  for (const [branch,sto] of [['BONE','WTP'],['KENDARI','KDR'],['MAKASSAR','BAL']]) {
    const values: (typeof pareData)[number] = [sto!,100,90,0,0,1000,960,970,960,950,.95];
    output.push(...block(branch!, [row(values)], row([branch!,...values.slice(1)] as (typeof pareData)[number])));
  }
  // Ignore the inconsistent overview value E7; only detail blocks may be authoritative.
  output.unshift([null,'PARE-PARE',5784,5259,1177]);
  output.push(...block('PARE-PARE', pareData.map(value => row(value)), row(
    ['PARE-PARE',5784,5259,108,59,129749,125240,125474,123344,118362,.9444], .65491234113530461,.9497
  )));
  return output;
}

test('VISIT matches the supplied PARE-PARE summary, composite rate and full STO lists', () => {
  const snapshot = parseValinsRows(fixture());
  const visit = snapshot.branches['PARE-PARE'].total.visit;
  assert.equal(visit.remaining,525);
  assert.equal(visit.omsetRemaining,49);
  assert.ok(Math.abs(visit.real-.72776433072076219)<1e-12);
  assert.ok(Math.abs(visit.growth!-.072851989585457577)<1e-12);
  const report = renderValinsReports(snapshot,'visit')[0]!;
  assert.match(report,/5\.259 \/ 5\.784 \(90,92%\)/);
  assert.match(report,/TOTAL REAL \(H\): 72,78%/);
  assert.match(report,/GROWTH \(H VS H-1\): \+7,29%/);
  const green = [...report.matchAll(/🟢 ([A-Z]{3}):/g)].map(match => match[1]);
  const red = [...report.matchAll(/🔴 ([A-Z]{3}):/g)].map(match => match[1]);
  assert.deepEqual(green,['MAJ','MMS','PLW','WON','ENR','MAK','RTP','MAS','SRK','PLP','PRE','PIN','RPN']);
  assert.deepEqual(red,['MAM','MLL','SID','TTE']);
  assert.match(report,/🔴 TTE: 52,27%/);
});

test('DC uses X REAL H, S/P coverage, and P-Q balance as three distinct metrics', () => {
  const report = renderValinsReports(parseValinsRows(fixture()),'dc')[0]!;
  assert.match(report,/125\.474 \/ 129\.749 \(96,71%\)/);
  assert.match(report,/QR CODE VALINS: 125\.240/);
  assert.match(report,/VALINS TO UIM: 123\.344/);
  assert.match(report,/SUCCESS UIM: 118\.362/);
  assert.match(report,/BELUM VALINS: 4\.509/);
  assert.match(report,/🔴 TOTAL REAL \(H\): 94,44%/);
  assert.match(report,/📉 GROWTH \(H VS H-1\): -0,53%/);
  assert.deepEqual([...report.matchAll(/🟢 ([A-Z]{3}):/g)].map(match=>match[1]),['MAJ','PLW','ENR','MAK','RTP','PLP','PRE','PIN']);
  assert.deepEqual([...report.matchAll(/🔴 ([A-Z]{3}):/g)].map(match=>match[1]),['MMS','WON','MAM','MAS','MLL','SRK','RPN','SID','TTE']);
});

test('two default messages, four-branch retrieval and exact-target classification', () => {
  const snapshot = parseValinsRows(fixture());
  assert.equal(renderValinsReports(snapshot).length,2);
  const all = renderValinsReports(snapshot,'all','SEMUA');
  assert.equal(all.length,8);
  assert.ok(all.every(message=>message.length<4096));
  assert.match(renderValinsReports(snapshot,'dc','BONE')[0]!,/🟢 WTP: 95,00%/);
  assert.match(renderValinsReports(snapshot,'dc','BONE')[0]!,/🟢 TOTAL REAL \(H\): 95,00%/);
});

test('empty H-1 yields unavailable growth, not zero', () => {
  const rows = fixture();
  const total = rows.at(-1)!;
  total[12]=null; total[13]=null; total[24]=null; total[25]=null;
  const messages = renderValinsReports(parseValinsRows(rows));
  assert.ok(messages.every(message=>message.includes('GROWTH (H VS H-1): Belum tersedia')));
});

test('invalid cached formulas, missing values, duplicate STO or broken totals reject upload', () => {
  const changes: ((rows: SheetData)=>void)[] = [
    rows=>{rows.at(-1)![4]=1177;},
    rows=>{rows.at(-1)![11]=.9092;},
    rows=>{rows.at(-1)![23]=null;},
    rows=>{rows.at(-1)![25]=0;},
    rows=>{rows.at(-1)![15]=129750; rows.at(-1)![21]=4510;},
    rows=>{const sto=rows.find(row=>row[1]==='TTE')!;sto[1]='SID';sto[14]='SID';},
    rows=>{const header=rows.find(row=>row[1]==='SA / STO')!;header[3]='WRONG';},
    rows=>{rows.at(-1)![1]='UNKNOWN';}
  ];
  for (const change of changes) {
    const rows=fixture(); change(rows);
    assert.throws(()=>parseValinsRows(rows),InputError);
  }
});

test('missing branches and corrupt XLSX fail without treating cells as zero', async () => {
  assert.throws(()=>parseValinsRows([]),InputError);
  await assert.rejects(parseValinsWorkbook(Buffer.from('not an XLSX')),InputError);
});

test('actual XLSX parser selects Sheet1 by name even when it is not the first sheet', async () => {
  const rows = fixture();
  const parsed = await parseValinsWorkbook(workbookBytes(rows));
  assert.equal(parsed.branches['PARE-PARE'].total.visit.remaining,525);
  assert.equal(parsed.branches['PARE-PARE'].total.dc.real,.9444);
  await assert.rejects(parseValinsWorkbook(workbookBytes(rows, 'DifferentSheet')),InputError);
});

test('VALINS commands validate branch and date arguments', () => {
  assert.deepEqual(parseValinsArguments([]),{scope:'PARE-PARE',date:undefined});
  assert.deepEqual(parseValinsArguments(['parepare','2026-10-27']),{scope:'PARE-PARE',date:'2026-10-27'});
  assert.deepEqual(parseValinsArguments(['semua']),{scope:'SEMUA',date:undefined});
  for (const args of [['palu'],['2026-02-30'],['bone','bone'],['2026-10-27','bone'],['bone','2026-10-27','extra']]) {
    assert.throws(()=>parseValinsArguments(args),InputError);
  }
});
