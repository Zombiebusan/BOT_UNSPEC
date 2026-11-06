import type { RichMessage } from './messages.js';
import { InputError, percent, previousDate, validDate, type Snapshot } from './report.js';
import { masterForStoredBranch } from './master.js';
import { UNSPEC_SERVICE_AREAS } from './unspec-service-areas.js';

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

export function buildUnspecServiceAreaRows(snapshot: Snapshot, previous: Snapshot | null, date = '2026-11-01'): UnspecServiceAreaRow[] {
  const areas: UnspecServiceAreaRow[] = UNSPEC_SERVICE_AREAS.map(area => {
    const current = snapshot.branches[area.branch], old = previous?.branches[area.branch];
    const fallback = masterForStoredBranch(area.branch, current.lis, date);
    const h = area.stos.reduce((sum, code) => sum + (current.stos[code] ?? 0), 0);
    const previousSaldo = old ? area.stos.reduce((sum, code) => sum + (old.stos[code] ?? 0), 0) : null;
    const lis = area.stos.reduce((sum, code) => sum + (current.stoLis?.[code] ?? fallback[code]!.lis), 0);
    const target = Math.floor(lis / 1000), real = h / lis * 100;
    return { level: 'sa', branch: area.branch === 'PARE-PARE' ? 'PARE PARE' : area.branch, serviceArea: area.label, h, previous: previousSaldo,
      target, gap: Math.max(0, h - target), closeHi: previousSaldo === null ? null : Math.max(0, previousSaldo - h), real,
      achieved: h === 0 ? 100 : Math.min(100, .1 / real * 100) };
  });
  const rows: UnspecServiceAreaRow[] = [], branchTotals = buildUnspecTableRows(snapshot, previous);
  for (const [index, branch] of TABLE_BRANCHES.entries()) {
    const label = branch === 'PARE-PARE' ? 'PARE PARE' : branch;
    const grouped = areas.filter(row => row.branch === label);
    if (grouped.reduce((sum, row) => sum + row.h, 0) !== snapshot.branches[branch].saldo ||
      (previous && grouped.reduce((sum, row) => sum + row.previous!, 0) !== previous.branches[branch].saldo)) throw new InputError('Rincian STO Service Area tidak cocok dengan total Branch.');
    const subtotal = branchTotals[index]!;
    rows.push(...grouped, { ...subtotal, level: 'branch', serviceArea: '', closeHi: subtotal.previous === null ? null : Math.max(0, subtotal.previous - subtotal.h) });
  }
  const regional = branchTotals.at(-1)!;
  rows.push({ ...regional, level: 'regional', serviceArea: '', closeHi: regional.previous === null ? null : Math.max(0, regional.previous - regional.h) });
  return rows;
}

const TABLE_HEADERS = ['BRANCH', 'SERVICE AREA', 'H', 'H-1', 'TARGET', 'GAP', 'CLOSE HI', 'REAL', 'ACH'];
function tableCells(rows: UnspecServiceAreaRow[]): string[][] {
  const integer = new Intl.NumberFormat('id-ID');
  return rows.map(item => [item.level === 'sa' ? '' : item.branch, item.serviceArea,
    integer.format(item.h), item.previous === null ? '—' : integer.format(item.previous), integer.format(item.target), integer.format(item.gap),
    item.closeHi === null ? '—' : integer.format(item.closeHi), percent(item.real), percent(item.achieved)]);
}
function tableWidths(rows: UnspecServiceAreaRow[]): number[] {
  const cells = tableCells(rows);
  return TABLE_HEADERS.map((header, column) => Math.max(header.length, ...cells.map(row => row[column]!.length)));
}
function renderRows(rows: UnspecServiceAreaRow[], widths: number[]): string {
  const cells = tableCells(rows);
  const sizes = widths.map(width => width + 2);
  const center = (value: string, size: number): string => ' '.repeat(Math.floor((size - value.length) / 2)) + value + ' '.repeat(Math.ceil((size - value.length) / 2));
  const border = (left: string, middle: string, right: string, firstJoin = middle) => left + sizes.map((size, index) => '─'.repeat(size) + (index === sizes.length - 1 ? right : index === 0 ? firstJoin : middle)).join('');
  const saldoWidth = sizes.slice(2, 6).reduce((sum, size) => sum + size, 0) + 3;
  const groupedSizes = [sizes[0]!, sizes[1]!, saldoWidth, sizes[6]!, sizes[7]!, sizes[8]!];
  const lines = [
    '┌' + groupedSizes.map(size => '─'.repeat(size)).join('┬') + '┐',
    '│' + ['BRANCH', 'SERVICE AREA', 'SALDO', 'CLOSE HI', 'REAL', 'ACH'].map((label, index) => center(label, groupedSizes[index]!)).join('│') + '│',
    '│' + ' '.repeat(sizes[0]!) + '│' + ' '.repeat(sizes[1]!) + '├' + sizes.slice(2, 6).map(size => '─'.repeat(size)).join('┬') + '┤' + sizes.slice(6).map(size => ' '.repeat(size)).join('│') + '│',
    '│' + ['','','H','H-1','TARGET','GAP','','',''].map((label, index) => center(label, sizes[index]!)).join('│') + '│',
    border('├', '┼', '┤'),
  ];
  cells.forEach((values, index) => {
    const row = rows[index]!;
    const rendered = values.map((value, column) => {
      const cell = column <= 1 ? ' ' + value.padEnd(widths[column]!) + ' ' : center(value, sizes[column]!);
      // Telegram does not support nesting bold entities inside pre/code blocks.
      // Bold Unicode letters retain one character per table column.
      return column === 0 && value === 'SULBAGSEL' ? cell.replace(value, '𝗦𝗨𝗟𝗕𝗔𝗚𝗦𝗘𝗟') : cell;
    });
    if (row.level === 'branch') {
      const mergedSize = sizes[0]! + sizes[1]! + 1;
      lines.push('│ ' + row.branch.padEnd(mergedSize - 2) + ' │' + rendered.slice(2).join('│') + '│');
    } else lines.push('│' + rendered.join('│') + '│');
    if (index === cells.length - 1) lines.push(border('└', '┴', '┘', row.level === 'branch' ? '─' : '┴'));
    else lines.push(border('├', '┼', '┤', row.level === 'branch' ? '┬' : rows[index + 1]!.level === 'branch' ? '┴' : '┼'));
  });
  return lines.join('\n');
}

export function renderUnspecTableText(snapshot: Snapshot, previous: Snapshot | null, date?: string): string {
  const rows = buildUnspecServiceAreaRows(snapshot, previous, date);
  return renderRows(rows, tableWidths(rows));
}

export function unspecTableMessages(snapshot: Snapshot, previous: Snapshot | null, date: string): RichMessage[] {
  if (!validDate(date)) throw new InputError('Tanggal tabel UNSPEC tidak valid.');
  const rows = buildUnspecServiceAreaRows(snapshot, previous, date), widths = tableWidths(rows);
  const compose = (part: UnspecServiceAreaRow[], index: number, count: number): RichMessage => {
    const table = renderRows(part, widths).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return { type: 'text', parse_mode: 'HTML', text: `📊 SULBAGSEL REPORT${count > 1 ? ` — Bagian ${index}/${count}` : ''}\nTanggal data: ${date} (WITA)\nH-1: ${previousDate(date)}${previous ? '' : ' (belum tersedia)'}\nTarget maksimal: 0,10%\n\n<pre>${table}</pre>` };
  };
  const groups: UnspecServiceAreaRow[][] = [];
  for (const row of rows) {
    if (groups.at(-1)?.[0]?.branch === row.branch) groups.at(-1)!.push(row);
    else groups.push([row]);
  }
  const pages: UnspecServiceAreaRow[][] = [];
  let page: UnspecServiceAreaRow[] = [];
  for (const group of groups) {
    if (compose([...page, ...group], 99, 99).text.length > 4096 && page.length) { pages.push(page); page = []; }
    if (compose(group, 99, 99).text.length > 4096) throw new InputError('Kelompok tabel Service Area terlalu panjang untuk Telegram.');
    page.push(...group);
  }
  if (page.length) pages.push(page);
  return pages.map((part, index) => compose(part, index + 1, pages.length));
}
