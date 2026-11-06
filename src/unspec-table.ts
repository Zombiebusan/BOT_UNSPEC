import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import type { PhotoMessage } from './messages.js';
import { InputError, percent, previousDate, validDate, type Snapshot } from './report.js';

const require = createRequire(import.meta.url);
const fontFiles = [
  require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
  require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'),
];
export const TABLE_BRANCHES = ['MAKASSAR', 'BONE', 'PARE-PARE', 'KENDARI'] as const;
export interface UnspecTableRow {
  branch: string;
  h: number;
  previous: number | null;
  target: number;
  gap: number;
  real: number;
  achieved: number;
}

export function buildUnspecTableRows(snapshot: Snapshot, previous: Snapshot | null): UnspecTableRow[] {
  const row = (branch: string, h: number, old: number | null, lis: number): UnspecTableRow => {
    if (!Number.isSafeInteger(h) || h < 0 || !Number.isFinite(lis) || lis <= 0) throw new InputError('Saldo atau basis LIS tabel UNSPEC tidak valid.');
    const target = Math.floor(lis / 1000), real = h / lis * 100;
    return { branch, h, previous: old, target, gap: Math.max(0, h - target), real, achieved: h === 0 ? 100 : Math.min(100, .1 / real * 100) };
  };
  const rows = TABLE_BRANCHES.map(branch => {
    const current = snapshot.branches[branch];
    return row(branch === 'PARE-PARE' ? 'PARE PARE' : branch, current.saldo, previous?.branches[branch].saldo ?? null, current.lis);
  });
  rows.push(row('SULBAGSEL', rows.reduce((sum, item) => sum + item.h, 0), previous ? TABLE_BRANCHES.reduce((sum, branch) => sum + previous.branches[branch].saldo, 0) : null,
    TABLE_BRANCHES.reduce((sum, branch) => sum + snapshot.branches[branch].lis, 0)));
  return rows;
}

export function renderUnspecTableSvg(snapshot: Snapshot, previous: Snapshot | null): string {
  const rows = buildUnspecTableRows(snapshot, previous);
  const integer = new Intl.NumberFormat('id-ID');
  const text = (value: string, x: number, y: number, bold = false, align = 'middle', size = bold ? 29 : 27) => `<text x="${x}" y="${y}" text-anchor="${align}" dominant-baseline="middle" font-size="${size}" font-weight="${bold ? 700 : 400}">${value}</text>`;
  const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const grid = [line(212, 60, 1012, 60)];
  for (let column = 1; column <= 6; column++) grid.push(line(12 + column * 200, column >= 2 && column <= 4 ? 60 : 12, 12 + column * 200, 348));
  for (let index = 0; index < 5; index++) grid.push(line(12, 108 + index * 48, 1412, 108 + index * 48));
  const labels = [text('BRANCH', 112, 60, true), text('SALDO', 612, 36, true), text('REAL', 1112, 60, true), text('ACH', 1312, 60, true),
    ...['H', 'H-1', 'TARGET', 'GAP'].map((label, index) => text(label, 312 + index * 200, 84, true))];
  rows.forEach((item, index) => {
    const y = 132 + index * 48, total = index === rows.length - 1;
    labels.push(text(item.branch, 22, y, total, 'start', 26));
    [integer.format(item.h), item.previous === null ? '—' : integer.format(item.previous), integer.format(item.target), integer.format(item.gap), percent(item.real), percent(item.achieved)]
      .forEach((value, column) => labels.push(text(value, 312 + column * 200, y, total)));
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1424" height="360" viewBox="0 0 1424 360" font-family="DejaVu Sans" fill="#000"><title>Rekap UNSPEC Sulbagsel</title><rect width="1424" height="360" fill="#fff"/><g fill="none" stroke="#000" stroke-width="2" shape-rendering="crispEdges"><rect x="12" y="12" width="1400" height="336"/>${grid.join('')}</g>${labels.join('')}</svg>`;
}

export function renderUnspecTablePng(snapshot: Snapshot, previous: Snapshot | null): Buffer {
  return new Resvg(renderUnspecTableSvg(snapshot, previous), { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
}

export function unspecTableMessage(snapshot: Snapshot, previous: Snapshot | null, date: string): PhotoMessage {
  if (!validDate(date)) throw new InputError('Tanggal tabel UNSPEC tidak valid.');
  return { type: 'photo', photo: 'attach://report_image', upload: { filename: `unspec-sulbagsel-${date}.png`, base64: renderUnspecTablePng(snapshot, previous).toString('base64') },
    caption: `📊 REKAP UNSPEC SULBAGSEL\nTanggal data: ${date} (WITA)\nH-1: ${previousDate(date)}${previous ? '' : ' (belum tersedia)'}\nTarget maksimal: 0,10%` };
}
