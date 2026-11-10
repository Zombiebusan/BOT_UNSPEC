import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { BRANCHES, MASTER } from '../src/master.js';
import { snapshotFromWorkzoneCounts, renderReports } from '../src/report.js';
import { branchImage, branchImageSvg, branchReportMessages, buildBranchImageRows } from '../src/unspec-branch-image.js';

const counts = Object.fromEntries(Object.keys(MASTER).map(code => [code, 1]));
const current = snapshotFromWorkzoneCounts(counts, '2026-11-10');
const previous = snapshotFromWorkzoneCounts(Object.fromEntries(Object.keys(MASTER).map(code => [code, 2])), '2026-11-09');
const timestamp = Date.parse('2026-11-10T03:30:00Z') / 1000;

test('dashboard branch images include every SA and STO once, with matching subtotals and dashboard order', () => {
  for (const branch of BRANCHES) {
    const rows = buildBranchImageRows(current, previous, branch, '2026-11-10');
    const stos = rows.filter(row => row.level === 'sto');
    const areas = rows.filter(row => row.level === 'sa');
    const expectedCodes = Object.keys(MASTER).filter(code => MASTER[code]!.branch === branch);
    assert.deepEqual(stos.map(row => row.label).sort(), expectedCodes.sort());
    assert.equal(new Set(stos.map(row => row.label)).size, stos.length);
    assert.equal(rows[0]!.h, current.branches[branch].saldo);
    assert.equal(rows[0]!.previous, previous.branches[branch].saldo);
    for (const key of ['h', 'previous', 'lis'] as const) {
      assert.equal(areas.reduce((sum, row) => sum + row[key]!, 0), rows[0]![key]);
      assert.equal(stos.reduce((sum, row) => sum + row[key]!, 0), rows[0]![key]);
    }
  }
  assert.deepEqual(buildBranchImageRows(current, previous, 'BONE', '2026-11-10').filter(row => row.level === 'sa').map(row => row.label), ['SERVICE AREA BANTAENG', 'SERVICE AREA BONE', 'SERVICE AREA WAJO']);
  assert.deepEqual(buildBranchImageRows(current, previous, 'MAKASSAR', '2026-11-10').filter(row => row.level === 'sa').map(row => row.label), ['SERVICE AREA BALAIKOTA', 'SERVICE AREA SUNGGUMINASA', 'SERVICE AREA MAROS', 'SERVICE AREA TAMALANREA', 'SERVICE AREA PANAKUKANG', 'SERVICE AREA SUDIANG']);
});

test('image metrics preserve real zero, missing H-1, signed delta, historical LIS and capped achievement', () => {
  const zero = snapshotFromWorkzoneCounts(Object.fromEntries(Object.keys(MASTER).map(code => [code, 0])), '2026-11-10');
  const row = buildBranchImageRows(zero, null, 'BONE', '2026-11-10')[0]!;
  assert.equal(row.h, 0);assert.equal(row.real, 0);assert.equal(row.achieved, 100);
  assert.equal(row.previous, null);assert.equal(row.previousReal, null);assert.equal(row.delta, null);
  const old = snapshotFromWorkzoneCounts(counts, '2026-10-31');
  const transition = buildBranchImageRows(current, old, 'BONE', '2026-11-01')[0]!;
  assert.equal(transition.previousReal, old.branches.BONE.saldo / old.branches.BONE.lis * 100);
  const changed = snapshotFromWorkzoneCounts({ ...counts, BLK: 100 }, '2026-11-10');
  assert.ok(buildBranchImageRows(changed, previous, 'BONE', '2026-11-10')[0]!.delta! > 0);
  assert.ok(buildBranchImageRows(current, previous, 'BONE', '2026-11-10')[0]!.delta! < 0);
});

test('each branch fits into one real PNG with header, final STO and all ten dashboard columns', async () => {
  for (const branch of BRANCHES) {
    const image = branchImageSvg(current, previous, branch, '2026-11-10', timestamp);
    assert.ok(image.svg.includes('BRANCH / SERVICE AREA / STO'));
    assert.ok(image.svg.includes('SALDO H-1'));
    assert.ok(image.svg.includes('ACHIEVED'));
    const rows = buildBranchImageRows(current, previous, branch, '2026-11-10');
    assert.ok(image.svg.includes('>'+rows.at(-1)!.label+'</text>'));
    const photo = await branchImage(current, previous, branch, '2026-11-10', timestamp);
    const buffer = Buffer.from(photo.upload!.base64, 'base64');
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format, 'png');assert.equal(metadata.width, image.width);assert.equal(metadata.height, image.height);
    assert.ok(buffer.length < 10 * 1024 * 1024);
    assert.ok(image.width + image.height < 10000);
    assert.ok(Math.max(image.width, image.height) / Math.min(image.width, image.height) < 20);
  }
});

test('Cetak Semua interleaves four unchanged complete reports and four branch images from one snapshot', async () => {
  const messages = await branchReportMessages(current, previous, timestamp, '2026-11-10', 'SEMUA');
  assert.equal(messages.length, 8);
  const reports = renderReports(current, previous, timestamp, '2026-11-10');
  for (const [index, branch] of BRANCHES.entries()) {
    assert.equal(messages[index * 2], reports[index]);
    const photo = messages[index * 2 + 1]!;
    assert.ok(typeof photo !== 'string' && photo.type === 'photo');
    assert.ok(photo.upload?.filename.includes(branch));
    assert.ok(photo.caption!.length < 1024);
  }
  const selected = await branchReportMessages(current, previous, timestamp, '2026-11-10', 'KENDARI');
  assert.equal(selected.length, 2);assert.equal(selected[0], reports[1]);
});
