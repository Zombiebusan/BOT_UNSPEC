import { readSheet, type SheetData } from 'read-excel-file/node';
import { BRANCHES, MASTER, type Branch } from './master.js';
import { InputError, percent, validDate } from './report.js';

export type ValinsKind = 'all' | 'visit' | 'dc';
export type ValinsScope = Branch | 'SEMUA';
interface Performance {
  target: number;
  real: number;
  previousReal: number | null;
  growth: number | null;
}
export interface VisitMetrics extends Performance {
  ont: number;
  done: number;
  remaining: number;
  changedPorts: number;
  omsetDone: number;
  omsetRemaining: number;
  psbRate: number;
  omsetRate: number;
}
export interface DcMetrics extends Performance {
  ontInService: number;
  qrCode: number;
  done: number;
  toUim: number;
  successUim: number;
  remaining: number;
}
export interface ValinsRow { code: string; visit: VisitMetrics; dc: DcMetrics }
export interface ValinsBranch { branch: Branch; total: ValinsRow; stos: ValinsRow[] }
export interface ValinsSnapshot { sheet: 'Sheet1'; branches: Record<Branch, ValinsBranch> }
export const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const number = new Intl.NumberFormat('id-ID');
const normalize = (value: unknown): string => typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, ' ') : '';
const isBranch = (value: string): value is Branch => BRANCHES.includes(value as Branch);

function close(actual: number, expected: number, cell: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new InputError(`Sheet1 ${cell}: angka tidak konsisten dengan perhitungannya. Buka Excel, hitung ulang rumus, lalu simpan dan upload kembali.`);
  }
}

function readRow(rows: SheetData, index: number): ValinsRow {
  const row = rows[index]!;
  const address = (column: string): string => `${column}${index + 1}`;
  const at = (column: string): unknown => row[column.charCodeAt(0) - 65];
  const numeric = (column: string): number => {
    const value = at(column);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InputError(`Sheet1 ${address(column)}: nilai numerik/hasil rumus tidak tersedia. Hitung ulang dan simpan file di Excel sebelum upload.`);
    }
    return value;
  };
  const count = (column: string): number => {
    const value = numeric(column);
    if (!Number.isSafeInteger(value) || value < 0) throw new InputError(`Sheet1 ${address(column)}: jumlah harus bilangan bulat tidak negatif.`);
    return value;
  };
  const ratio = (column: string): number => {
    const value = numeric(column);
    if (value < 0 || value > 1) throw new InputError(`Sheet1 ${address(column)}: realisasi harus bernilai 0–100%.`);
    return value;
  };
  const previous = (column: string): number | null => at(column) == null ? null : ratio(column);
  const target = (column: string): number => {
    const value = numeric(column);
    if (value <= 0 || value > 100) throw new InputError(`Sheet1 ${address(column)}: target tidak valid.`);
    return value > 1 ? value / 100 : value;
  };
  const code = normalize(at('B'));
  if (code !== normalize(at('O'))) throw new InputError(`Sheet1 baris ${index + 1}: label VISIT dan DC berbeda.`);
  const ont = count('C'), done = count('D'), remaining = count('E');
  const changedPorts = count('G'), omsetDone = count('H'), omsetRemaining = count('I');
  close(remaining, ont - done, address('E'));
  close(omsetRemaining, changedPorts - omsetDone, address('I'));
  const psbRate = ont === 0 ? 1 : done / ont;
  const omsetRate = changedPorts === 0 ? 1 : omsetDone / changedPorts;
  if ((ont === 0 && done !== 0) || (changedPorts === 0 && omsetDone !== 0)) throw new InputError(`Sheet1 baris ${index + 1}: jumlah valins melebihi basis ONT.`);
  close(ratio('F'), psbRate, address('F'));
  close(ratio('J'), omsetRate, address('J'));
  const real = (psbRate + omsetRate) / 2;
  close(ratio('L'), real, address('L'));
  const oldVisit = previous('M');
  const visitGrowth = oldVisit === null ? null : real - oldVisit;
  if (visitGrowth !== null && at('N') != null) close(numeric('N'), visitGrowth, address('N'));
  const ontInService = count('P'), qrCode = count('Q'), dcDone = count('S');
  const toUim = count('T'), successUim = count('U'), dcRemaining = count('V');
  close(dcRemaining, ontInService - qrCode, address('V'));
  if (dcDone > ontInService || toUim > dcDone || successUim > toUim) throw new InputError(`Sheet1 baris ${index + 1}: jumlah SUDAH VALINS/To UIM/SUCCESS UIM tidak konsisten.`);
  // REAL DC is a dedicated source metric. It is NOT S/P or Q/P.
  const dcReal = ratio('X');
  const oldDc = previous('Y');
  const dcGrowth = oldDc === null ? null : dcReal - oldDc;
  if (dcGrowth !== null && at('Z') != null) close(numeric('Z'), dcGrowth, address('Z'));
  return {
    code,
    visit: { ont, done, remaining, changedPorts, omsetDone, omsetRemaining, psbRate, omsetRate,
      target: target('K'), real, previousReal: oldVisit, growth: visitGrowth },
    dc: { ontInService, qrCode, done: dcDone, toUim, successUim, remaining: dcRemaining,
      target: target('W'), real: dcReal, previousReal: oldDc, growth: dcGrowth }
  };
}

function validateTotals(branch: ValinsBranch): void {
  const total = branch.total;
  for (const key of ['ont', 'done', 'remaining', 'changedPorts', 'omsetDone', 'omsetRemaining'] as const) {
    close(branch.stos.reduce((sum, sto) => sum + sto.visit[key], 0), total.visit[key], `${branch.branch} VISIT ${key}`);
  }
  for (const key of ['ontInService', 'qrCode', 'done', 'toUim', 'successUim', 'remaining'] as const) {
    close(branch.stos.reduce((sum, sto) => sum + sto.dc[key], 0), total.dc[key], `${branch.branch} DC ${key}`);
  }
  for (const sto of branch.stos) {
    close(sto.visit.target, total.visit.target, `${sto.code} target VISIT`);
    close(sto.dc.target, total.dc.target, `${sto.code} target DC`);
    if (MASTER[sto.code] && MASTER[sto.code]!.branch !== branch.branch) {
      throw new InputError(`Sheet1: STO ${sto.code} berada pada blok branch yang salah.`);
    }
  }
}

export function parseValinsRows(rows: SheetData): ValinsSnapshot {
  if (!rows.length || rows.length > 10000 || rows.some(row => row.length > 100)) throw new InputError('Ukuran/struktur Sheet1 tidak sesuai template VALINS.');
  const branches: Partial<Record<Branch, ValinsBranch>> = {};
  const seen = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    if (!normalize(rows[index]?.[1]).startsWith('VALINS VISIT ODP') ||
        normalize(rows[index]?.[14]) !== 'VALINS DC QR CODE & SERVICE' ||
        normalize(rows[index + 1]?.[1]) !== 'SA / STO') continue;
    const headers = rows[index + 1]!;
    const expected: Record<number, string> = {
      2: 'ONT BARU', 3: 'VALINS PSB', 4: 'BELUM VALINS', 5: 'REAL', 6: 'ONT BERUBAH PORT',
      7: 'VALINS OMSET', 8: 'BELUM VALINS', 9: 'REAL', 10: 'TARGET', 14: 'SA / STO',
      16: 'QR CODE VALINS', 18: 'SUDAH VALINS', 19: 'VALINS TO UIM', 20: 'SUCCESS UIM', 21: 'BELUM VALINS', 22: 'TARGET'
    };
    for (const [column, label] of Object.entries(expected)) {
      if (normalize(headers[Number(column)]) !== label) throw new InputError(`Sheet1: header kolom ${String.fromCharCode(65 + Number(column))} pada baris ${index + 2} berubah.`);
    }
    if (!normalize(headers[15]).startsWith('ONT IN SERVICE') ||
        normalize(rows[index + 2]?.[11]) !== 'H' || normalize(rows[index + 2]?.[12]) !== 'H-1' ||
        normalize(rows[index + 2]?.[23]) !== 'H' || normalize(rows[index + 2]?.[24]) !== 'H-1') {
      throw new InputError('Sheet1: kolom REAL H/H-1 tidak sesuai template.');
    }
    const stos: ValinsRow[] = [];
    let closed = false;
    for (let cursor = index + 3; cursor < rows.length; cursor++) {
      const label = normalize(rows[cursor]?.[1]);
      if (!label) continue;
      if (isBranch(label)) {
        if (branches[label] || !stos.length) throw new InputError(`Sheet1: blok ${label} ganda atau tidak memiliki STO.`);
        const branch = { branch: label, total: readRow(rows, cursor), stos };
        validateTotals(branch);
        branches[label] = branch;
        closed = true;
        index = cursor;
        break;
      }
      if (label.startsWith('SA ')) continue; // No double-counting SA subtotals.
      if (!/^[A-Z0-9]{2,5}$/.test(label)) throw new InputError(`Sheet1 baris ${cursor + 1}: label STO tidak dikenal.`);
      if (seen.has(label)) throw new InputError(`Sheet1: STO ${label} tercantum lebih dari sekali.`);
      seen.add(label);
      stos.push(readRow(rows, cursor));
    }
    if (!closed) throw new InputError('Sheet1: blok detail tidak memiliki total branch.');
  }
  const missing = BRANCHES.filter(branch => !branches[branch]);
  if (missing.length) throw new InputError(`Sheet1: blok detail branch belum lengkap (${missing.join(', ')}). Gunakan template Excel VALINS yang sama.`);
  return { sheet: 'Sheet1', branches: branches as Record<Branch, ValinsBranch> };
}

export async function parseValinsWorkbook(bytes: Buffer): Promise<ValinsSnapshot> {
  if (bytes.length > MAX_XLSX_BYTES) throw new InputError('Ukuran Excel maksimal 10 MB.');
  let rows: SheetData;
  try { rows = await readSheet(bytes, 'Sheet1'); }
  catch { throw new InputError('File Excel tidak valid atau Sheet1 tidak ditemukan. Kirim .xlsx dengan Sheet1 sesuai template VALINS.'); }
  return parseValinsRows(rows);
}

function growthLine(value: number | null): string {
  if (value === null) return '📈 GROWTH (H VS H-1): Belum tersedia';
  const stable = Math.abs(value) < 1e-12 ? 0 : value;
  return `${stable < 0 ? '📉' : '📈'} GROWTH (H VS H-1): ${stable > 0 ? '+' : ''}${percent(stable * 100)}`;
}
function categories(branch: ValinsBranch, kind: 'visit' | 'dc'): string[] {
  const target = branch.total[kind].target;
  const good = branch.stos.filter(sto => sto[kind].real >= target);
  const bad = branch.stos.filter(sto => sto[kind].real < target);
  return [
    `🏆 STO MENCAPAI TARGET (TOTAL H ≥ ${percent(target * 100)})`, '',
    ...(good.length ? good.map(sto => `🟢 ${sto.code}: ${percent(sto[kind].real * 100)}`) : ['Tidak ada STO yang mencapai target.']), '',
    `⚠️ STO PERLU ATENSI (TOTAL H < ${percent(target * 100)})`, '',
    ...(bad.length ? bad.map(sto => `🔴 ${sto.code}: ${percent(sto[kind].real * 100)}`) : ['Tidak ada STO di bawah target.']), '',
    'Ket:', '🟢 Mencapai/melebihi target · 🔴 Di bawah target', '',
    'Source data: https://access-quality.telkom.co.id'
  ];
}
export function renderValinsReports(snapshot: ValinsSnapshot, kind: ValinsKind = 'all', scope: ValinsScope = 'PARE-PARE'): string[] {
  const messages: string[] = [];
  for (const name of scope === 'SEMUA' ? BRANCHES : [scope]) {
    const branch = snapshot.branches[name];
    const visit = branch.total.visit, dc = branch.total.dc;
    if (kind !== 'dc') {
      const achieved = visit.real >= visit.target;
      messages.push([
        `📊 SUMMARY VALINS VISIT ODP (PROV, ASR DAN MAINT) – ${name}`, '',
        `SUDAH VALINS / TOTAL ONT: ${number.format(visit.done)} / ${number.format(visit.ont)} (${percent(visit.psbRate * 100)})`,
        `SALDO BELUM VALINS PSB: ${number.format(visit.remaining)}`,
        `SALDO BELUM VALINS OMSET: ${number.format(visit.omsetRemaining)}`, '',
        `🎯 TARGET: ${percent(visit.target * 100)}`,
        `${achieved ? '🟢' : '🔴'} TOTAL REAL (H): ${percent(visit.real * 100)} (${achieved ? 'Mencapai target' : 'Di bawah target'})`,
        growthLine(visit.growth), '', ...categories(branch, 'visit')
      ].join('\n'));
    }
    if (kind !== 'visit') {
      const achieved = dc.real >= dc.target;
      const ratioText = dc.ontInService ? percent(dc.done / dc.ontInService * 100) : 'Tidak ada basis ONT';
      messages.push([
        `📊 SUMMARY VALINS DC QR CODE & SERVICE – ${name}`, '',
        `SUDAH VALINS / ONT IN SERVICE: ${number.format(dc.done)} / ${number.format(dc.ontInService)} (${ratioText})`,
        `QR CODE VALINS: ${number.format(dc.qrCode)}`,
        `VALINS TO UIM: ${number.format(dc.toUim)}`,
        `SUCCESS UIM: ${number.format(dc.successUim)}`,
        `BELUM VALINS: ${number.format(dc.remaining)}`, '',
        `🎯 TARGET: ${percent(dc.target * 100)}`,
        `${achieved ? '🟢' : '🔴'} TOTAL REAL (H): ${percent(dc.real * 100)} (${achieved ? 'Mencapai target' : 'Belum mencapai target'})`,
        growthLine(dc.growth), '', ...categories(branch, 'dc')
      ].join('\n'));
    }
  }
  return messages;
}

export function parseValinsArguments(args: string[]): { scope: ValinsScope; date?: string } {
  const usage = 'Gunakan /valins [branch] [YYYY-MM-DD], /valins_visit, atau /valins_dc. Branch: pare-pare, bone, kendari, makassar, semua.';
  if (args.length > 2) throw new InputError(usage);
  let scope: ValinsScope = 'PARE-PARE';
  let date: string | undefined;
  let hasScope = false;
  for (const value of args) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      if (date || !validDate(value)) throw new InputError(usage);
      date = value;
    } else {
      const name = value.toUpperCase().replace(/^PAREPARE$/, 'PARE-PARE');
      if (name !== 'SEMUA' && !isBranch(name)) throw new InputError(usage);
      if (hasScope || date) throw new InputError(usage);
      scope = name;
      hasScope = true;
    }
  }
  return { scope, date };
}
