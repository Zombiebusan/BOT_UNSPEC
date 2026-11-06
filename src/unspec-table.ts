import type { RichMessage } from './messages.js';
import { InputError, percent, previousDate, validDate, type Snapshot } from './report.js';

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

export function renderUnspecTableText(snapshot: Snapshot, previous: Snapshot | null): string {
  const rows = buildUnspecTableRows(snapshot, previous);
  const integer = new Intl.NumberFormat('id-ID');
  const headers = ['BRANCH', 'H', 'H-1', 'TARGET', 'GAP', 'REAL', 'ACH'];
  const cells = rows.map(item => [item.branch, integer.format(item.h), item.previous === null ? '—' : integer.format(item.previous), integer.format(item.target), integer.format(item.gap), percent(item.real), percent(item.achieved)]);
  const widths = headers.map((header, column) => Math.max(header.length, ...cells.map(row => row[column]!.length)));
  const sizes = widths.map(width => width + 2);
  const center = (value: string, size: number): string => ' '.repeat(Math.floor((size - value.length) / 2)) + value + ' '.repeat(Math.ceil((size - value.length) / 2));
  const border = (left: string, middle: string, right: string) => left + sizes.map(size => '─'.repeat(size)).join(middle) + right;
  const saldoWidth = sizes.slice(1, 5).reduce((sum, size) => sum + size, 0) + 3;
  const groupedSizes = [sizes[0]!, saldoWidth, sizes[5]!, sizes[6]!];
  const lines = [
    '┌' + groupedSizes.map(size => '─'.repeat(size)).join('┬') + '┐',
    '│' + ['BRANCH', 'SALDO', 'REAL', 'ACH'].map((label, index) => center(label, groupedSizes[index]!)).join('│') + '│',
    '│' + ' '.repeat(sizes[0]!) + '├' + sizes.slice(1, 5).map(size => '─'.repeat(size)).join('┬') + '┤' + ' '.repeat(sizes[5]!) + '│' + ' '.repeat(sizes[6]!) + '│',
    '│' + ['','H','H-1','TARGET','GAP','',''].map((label, index) => center(label, sizes[index]!)).join('│') + '│',
    border('├', '┼', '┤'),
  ];
  cells.forEach((values, index) => {
    lines.push('│' + values.map((value, column) => column === 0 ? ' ' + value.padEnd(widths[0]!) + ' ' : center(value, sizes[column]!)).join('│') + '│');
    lines.push(index === cells.length - 1 ? border('└', '┴', '┘') : border('├', '┼', '┤'));
  });
  return lines.join('\n');
}

export function unspecTableMessage(snapshot: Snapshot, previous: Snapshot | null, date: string): RichMessage {
  if (!validDate(date)) throw new InputError('Tanggal tabel UNSPEC tidak valid.');
  const table = renderUnspecTableText(snapshot, previous).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return { type: 'text', parse_mode: 'HTML', text: `📊 REKAP UNSPEC SULBAGSEL\nTanggal data: ${date} (WITA)\nH-1: ${previousDate(date)}${previous ? '' : ' (belum tersedia)'}\nTarget maksimal: 0,10%\n\n<pre>${table}</pre>` };
}
