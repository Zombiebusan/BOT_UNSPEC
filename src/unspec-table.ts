import type { RichMessage } from './messages.js';
import { InputError, percent, previousDate, validDate, type Snapshot } from './report.js';
import { masterForStoredBranch } from './master.js';
import { UNSPEC_SERVICE_AREAS } from './unspec-service-areas.js';
import { areaBalances, isExactMorningTime, isMorningBaselineTime, morningBalances, type MorningBalances, type ReportMorningBaseline } from './morning-baseline.js';

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

export interface UnspecServiceAreaRow extends UnspecTableRow { serviceArea: string; closeHi: number | null; level: 'sa' | 'branch' | 'regional' }

export function buildUnspecServiceAreaRows(snapshot: Snapshot, previous: Snapshot | null, date = '2026-11-01', morning: MorningBalances | null = null): UnspecServiceAreaRow[] {
  const opening = morning ? areaBalances(morning) : null;
  const areas: UnspecServiceAreaRow[] = UNSPEC_SERVICE_AREAS.map(area => {
    const current = snapshot.branches[area.branch], old = previous?.branches[area.branch];
    const fallback = masterForStoredBranch(area.branch, current.lis, date);
    const h = area.stos.reduce((sum, code) => sum + (current.stos[code] ?? 0), 0);
    const previousSaldo = old ? area.stos.reduce((sum, code) => sum + (old.stos[code] ?? 0), 0) : null;
    const morningSaldo = opening ? opening[area.label]! : null;
    const lis = area.stos.reduce((sum, code) => sum + (current.stoLis?.[code] ?? fallback[code]!.lis), 0);
    const target = Math.floor(lis / 1000), real = h / lis * 100;
    return { level: 'sa', branch: area.branch === 'PARE-PARE' ? 'PARE PARE' : area.branch, serviceArea: area.label, h, previous: previousSaldo,
      target, gap: Math.max(0, h - target), closeHi: morningSaldo === null ? null : morningSaldo - h, real,
      achieved: h === 0 ? 100 : Math.min(100, .1 / real * 100) };
  });
  const rows: UnspecServiceAreaRow[] = [], branchTotals = buildUnspecTableRows(snapshot, previous);
  for (const [index, branch] of TABLE_BRANCHES.entries()) {
    const label = branch === 'PARE-PARE' ? 'PARE PARE' : branch;
    const grouped = areas.filter(row => row.branch === label);
    if (grouped.reduce((sum, row) => sum + row.h, 0) !== snapshot.branches[branch].saldo ||
      (previous && grouped.reduce((sum, row) => sum + row.previous!, 0) !== previous.branches[branch].saldo)) throw new InputError('Rincian STO Service Area tidak cocok dengan total Branch.');
    const subtotal = branchTotals[index]!;
    rows.push(...grouped, { ...subtotal, level: 'branch', serviceArea: '', closeHi: opening === null ? null : UNSPEC_SERVICE_AREAS.filter(area => area.branch === branch).reduce((sum, area) => sum + opening[area.label]!, 0) - subtotal.h });
  }
  const regional = branchTotals.at(-1)!;
  rows.push({ ...regional, level: 'regional', serviceArea: '', closeHi: opening === null ? null : Object.values(opening).reduce((sum, value) => sum + value, 0) - regional.h });
  return rows;
}

const TABLE_HEADERS = ['BRANCH/SA', 'H', 'H-1', 'TARGET', 'GAP', 'CLOSE HI', 'REAL', 'ACH'];
function tableCells(rows: UnspecServiceAreaRow[]): string[][] {
  const integer = new Intl.NumberFormat('id-ID');
  return rows.map(item => [item.level === 'sa' ? item.serviceArea : item.branch,
    integer.format(item.h), item.previous === null ? '—' : integer.format(item.previous), integer.format(item.target), integer.format(item.gap),
    item.closeHi === null ? '—' : integer.format(item.closeHi), percent(item.real), percent(item.achieved)]);
}
function tableWidths(rows: UnspecServiceAreaRow[]): number[] {
  const cells = tableCells(rows);
  return TABLE_HEADERS.map((header, column) => Math.max(header.length, ...cells.map(row => row[column]!.length)));
}
function renderRows(rows: UnspecServiceAreaRow[], widths: number[], padding = 1): string {
  const cells = tableCells(rows);
  const sizes = widths.map(width => width + padding * 2);
  const space = ' '.repeat(padding);
  const center = (value: string, size: number): string => ' '.repeat(Math.floor((size - value.length) / 2)) + value + ' '.repeat(Math.ceil((size - value.length) / 2));
  const border = (left: string, middle: string, right: string) => left + sizes.map(size => '─'.repeat(size)).join(middle) + right;
  const saldoWidth = sizes.slice(1, 5).reduce((sum, size) => sum + size, 0) + 3;
  const groupedSizes = [sizes[0]!, saldoWidth, sizes[5]!, sizes[6]!, sizes[7]!];
  const lines = [
    '┌' + groupedSizes.map(size => '─'.repeat(size)).join('┬') + '┐',
    '│' + ['BRANCH/SA', 'SALDO', 'CLOSE HI', 'REAL', 'ACH'].map((label, index) => center(label, groupedSizes[index]!)).join('│') + '│',
    '│' + ' '.repeat(sizes[0]!) + '├' + sizes.slice(1, 5).map(size => '─'.repeat(size)).join('┬') + '┤' + sizes.slice(5).map(size => ' '.repeat(size)).join('│') + '│',
    '│' + ['','H','H-1','TARGET','GAP','','',''].map((label, index) => center(label, sizes[index]!)).join('│') + '│',
    border('├', '┼', '┤'),
  ];
  cells.forEach((values, index) => {
    const row = rows[index]!;
    // Keep the regional label in the same monospace font as the rest of the table.
    // Mathematical bold Unicode glyphs trigger fallback fonts in Telegram clients.
    const rendered = values.map((value, column) => column === 0 ? space + value.padEnd(widths[column]!) + space : center(value, sizes[column]!));
    lines.push('│' + rendered.join('│') + '│');
    if (index === cells.length - 1) lines.push(border('└', '┴', '┘'));
    else if (row.level === 'branch' || rows[index + 1]!.level !== 'sa') lines.push(border('├', '┼', '┤'));
  });
  return lines.join('\n');
}

export function renderUnspecTableText(snapshot: Snapshot, previous: Snapshot | null, date?: string, morning: MorningBalances | null = null): string {
  const rows = buildUnspecServiceAreaRows(snapshot, previous, date, morning);
  return renderRows(rows, tableWidths(rows));
}

export function unspecTableMessages(snapshot: Snapshot, previous: Snapshot | null, date: string, morning: ReportMorningBaseline | null = null): RichMessage[] {
  if (!validDate(date)) throw new InputError('Tanggal tabel UNSPEC tidak valid.');
  if (morning && !isMorningBaselineTime(morning.capturedAt, date)) throw new InputError('Tanggal/jam acuan awal tidak sesuai hari operasional report.');
  const rows = buildUnspecServiceAreaRows(snapshot, previous, date, morning ? morningBalances(morning) : null), widths = tableWidths(rows);
  const captureLabel = morning ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(morning.capturedAt)) : '';
  const morningLabel = morning ? (isExactMorningTime(morning.capturedAt) ? 'Acuan 08.00: terekam ' : 'Acuan awal tersedia: ')+captureLabel+' WITA' : 'Acuan awal belum tersedia';
  const compose = (padding: number): RichMessage => {
    const table = renderRows(rows, widths, padding).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return { type: 'text', parse_mode: 'HTML', text: `📊 SULBAGSEL REPORT\nTanggal data: ${date} (WITA)\nH-1: ${previousDate(date)}${previous ? '' : ' (belum tersedia)'}\n${morningLabel}\nTarget maksimal: 0,10%\n\n<pre>${table}</pre>` };
  };
  for (const padding of [1, 0]) {
    const message = compose(padding);
    if (message.text.length <= 4096) return [message];
  }
  throw new InputError('Report terlalu panjang untuk satu pesan Telegram. Tidak ada baris yang dipotong.');
}
