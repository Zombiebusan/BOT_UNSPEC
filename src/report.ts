import { parse } from 'csv-parse/sync';
import { BRANCHES, EXCLUDED_STOS, masterForDate, masterForStoredBranch, type Branch } from './master.js';

export class InputError extends Error {}
export interface BranchSnapshot { saldo: number; lis: number; stos: Record<string, number>; stoLis?: Record<string, number> }
export interface Snapshot {
  branches: Record<Branch, BranchSnapshot>;
  totalRows: number;
  duplicateRows: number;
  excludedRows: number;
  filteredRows: number;
}
const integer = new Intl.NumberFormat('id-ID');
const decimal = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const percent = (value: number): string => `${decimal.format(value)}%`;
export const MAX_CSV_BYTES = 10 * 1024 * 1024;

export function snapshotFromWorkzoneCounts(counts: Record<string, number>, date: string): Snapshot {
  if (!validDate(date)) throw new InputError('Tanggal laporan API tidak valid.');
  const master = masterForDate(date);
  const expected = Object.keys(master).sort();
  if (JSON.stringify(Object.keys(counts).sort()) !== JSON.stringify(expected)) throw new InputError('Mapping STO API tidak lengkap atau berbeda dari master bot.');
  const branches = Object.fromEntries(BRANCHES.map(branch => [branch, {
    saldo: 0, lis: 0, stos: {} as Record<string, number>, stoLis: {} as Record<string, number>
  }])) as Record<Branch, BranchSnapshot>;
  let totalRows = 0;
  for (const code of expected) {
    const saldo = counts[code];
    if (!Number.isSafeInteger(saldo) || saldo! < 0 || saldo! > 100_000) throw new InputError('Nilai saldo STO API tidak valid.');
    const sto = master[code]!, branch = branches[sto.branch];
    branch.saldo += saldo!; branch.lis += sto.lis; branch.stos[code] = saldo!; branch.stoLis![code] = sto.lis;
    totalRows += saldo!;
  }
  if (totalRows > 100_000) throw new InputError('Jumlah tiket API melebihi batas laporan.');
  return { branches, totalRows, duplicateRows: 0, excludedRows: 0, filteredRows: 0 };
}

export function parseSnapshot(text: string, reportDate?: string): Snapshot {
  if (reportDate && !validDate(reportDate)) throw new InputError('Tanggal laporan tidak valid.');
  const master = masterForDate(reportDate);
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) throw new InputError('Ukuran CSV maksimal 10 MB.');
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  let headers: string[] = [];
  let rows: Record<string, string>[];
  try {
    rows = parse(text, {
      bom: true, delimiter, skip_empty_lines: true, trim: true,
      max_record_size: 1024 * 1024,
      columns: (names: string[]) => {
        headers = names.map(name => name.trim().toUpperCase());
        if (new Set(headers).size !== headers.length) throw new Error('Header duplikat.');
        return headers;
      }
    }) as Record<string, string>[];
  } catch {
    throw new InputError('Format CSV tidak valid. Periksa jumlah kolom, header duplikat, dan tanda kutip.');
  }
  if (!headers.includes('INCIDENT') || !headers.includes('WORKZONE')) {
    throw new InputError('Kolom INCIDENT dan WORKZONE wajib tersedia.');
  }
  if (!rows.length) throw new InputError('CSV kosong. Tidak ada data yang diproses.');
  if (rows.length > 100_000) throw new InputError('CSV maksimal 100.000 baris.');
  const unique = new Map<string, Record<string, string>>();
  for (const [index, row] of rows.entries()) {
    if (!row.INCIDENT?.trim() || !row.WORKZONE?.trim()) {
      throw new InputError(`Baris data ${index + 1}: INCIDENT atau WORKZONE kosong.`);
    }
    unique.set(row.INCIDENT.trim().toUpperCase(), row);
  }
  const branches = Object.fromEntries(BRANCHES.map(branch => [branch, {
    saldo: 0,
    lis: Object.values(master).filter(sto => sto.branch === branch).reduce((sum, sto) => sum + sto.lis, 0),
    stos: Object.fromEntries(Object.entries(master).filter(([, sto]) => sto.branch === branch).map(([code]) => [code, 0])),
    stoLis: Object.fromEntries(Object.entries(master).filter(([, sto]) => sto.branch === branch).map(([code, sto]) => [code, sto.lis]))
  }])) as Record<Branch, BranchSnapshot>;
  let excludedRows = 0;
  let filteredRows = 0;
  const unknown = new Set<string>();
  const inactive = new Set(['CLOSED', 'RESOLVED', 'CANCELLED', 'CANCELED', 'CLOSE', 'RESOLVE']);
  for (const row of unique.values()) {
    if ((headers.includes('SUMMARY') && !/\bUNSPEC\b/i.test(row.SUMMARY ?? '')) ||
        inactive.has((row.STATUS ?? '').trim().toUpperCase())) {
      filteredRows++;
      continue;
    }
    const code = row.WORKZONE!.trim().toUpperCase();
    const sto = master[code];
    if (!sto) {
      if (EXCLUDED_STOS.has(code)) excludedRows++;
      else unknown.add(code);
      continue;
    }
    branches[sto.branch].saldo++;
    branches[sto.branch].stos[code]!++;
  }
  if (unknown.size) {
    throw new InputError(`STO belum terpetakan: ${[...unknown].slice(0, 15).join(', ')}. Perbarui master sebelum mengupload ulang.`);
  }
  return { branches, totalRows: rows.length, duplicateRows: rows.length - unique.size, excludedRows, filteredRows };
}

export function witaDate(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
export function validDate(value: string): boolean {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function resolveReportDate(caption: string | undefined, timestampSeconds: number): string {
  if (!caption?.trim()) return witaDate(timestampSeconds);
  const match = /^(?:tanggal\s*=\s*)?(\S+)$/i.exec(caption.trim());
  if (!match?.[1] || !validDate(match[1])) {
    throw new InputError('Caption tanggal tidak valid. Gunakan YYYY-MM-DD atau tanggal=YYYY-MM-DD, misalnya 2026-10-25, atau kosongkan untuk tanggal otomatis.');
  }
  return match[1];
}
export function previousDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
export function resolveCsvReportDate(caption: string | undefined, timestampSeconds: number): string {
  // Export UNSPEC rutin berisi posisi sehari sebelum upload (WITA).
  return caption?.trim() ? resolveReportDate(caption, timestampSeconds) : previousDate(witaDate(timestampSeconds));
}
export function updateLabel(timestampSeconds: number, reportDate = witaDate(timestampSeconds)): string {
  const uploaded = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(timestampSeconds * 1000)).replace(' pukul ', ' | Update ') + ' WITA';
  if (reportDate === witaDate(timestampSeconds)) return uploaded;
  const label = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(`${reportDate}T12:00:00+08:00`));
  return `${label}\n🕒 Diupload: ${uploaded}`;
}

export function renderReports(snapshot: Snapshot, previous: Snapshot | null, timestampSeconds: number, reportDate = witaDate(timestampSeconds)): string[] {
  return BRANCHES.map(branch => {
    const current = snapshot.branches[branch];
    const old = previous?.branches[branch];
    const rate = current.saldo / current.lis * 100;
    const achieved = current.saldo * 1000 <= current.lis;
    // Compare fractions directly: two distinct rates may round to the same displayed value.
    const delta = old ? rate - old.saldo / old.lis * 100 : null;
    const direction = old ? Math.sign(current.saldo * old.lis - old.saldo * current.lis) : 0;
    const deltaText = delta === null ? 'Belum tersedia' :
      `${delta > 0 ? '+' : ''}${decimal.format(Object.is(delta, -0) ? 0 : delta)}% (${direction < 0 ? 'Membaik' : direction > 0 ? 'Memburuk' : 'Tetap'})`;
    const fallbackMaster = masterForStoredBranch(branch, current.lis, reportDate);
    const stos = Object.entries(current.stos).map(([code, saldo]) => {
      const lis = current.stoLis?.[code] ?? fallbackMaster[code]!.lis;
      return { code, saldo, lis, rate: saldo / lis * 100 };
    });
    const good = stos.filter(sto => sto.saldo * 1000 <= sto.lis).sort((a, b) => a.rate - b.rate || a.code.localeCompare(b.code));
    const bad = stos.filter(sto => sto.saldo * 1000 > sto.lis).sort((a, b) => b.rate - a.rate || a.code.localeCompare(b.code));
    const highest = bad[0];
    return [
      `📊 SUMMARY PERFORMANSI UNSPEC – BRANCH ${branch}`,
      '',
      `SALDO (H): ${integer.format(current.saldo)}`,
      `SALDO (H-1): ${old ? integer.format(old.saldo) : 'Belum tersedia'}`,
      `TARGET SALDO 0,10%: ${integer.format(Math.floor(current.lis / 1000))}`,
      `TOTAL LIS: ${integer.format(current.lis)}`, '',
      '🎯 TARGET MAKSIMAL: 0,10%',
      `🚀 REALISASI BRANCH (H): ${achieved ? '🟢' : '🔴'} ${percent(rate)} (${achieved ? 'Mencapai target' : 'Di atas target'})`,
      `📈 GROWTH REALISASI (H vs H-1): ${deltaText}`, '',
      '🏆 STO TERENDAH / MENCAPAI TARGET', '',
      ...(good.length ? good.map(sto => `🟢 ${sto.code}: ${percent(sto.rate)}`) : ['Tidak ada STO yang mencapai target.']), '',
      '⚠️ STO PERLU ATENSI (Melebihi Batas Target)', '',
      ...(bad.length ? bad.map(sto => `🔴 ${sto.code}: ${percent(sto.rate)}${highest && sto.saldo * highest.lis === highest.saldo * sto.lis ? ' (Tertinggi)' : ''}`) : ['Tidak ada STO di atas target.']), '',
      'Ket: 🟢 = Mencapai target (≤ 0,10%) | 🔴 = Di atas target (> 0,10%)'
    ].join('\n');
  });
}

export function stripReportTimestamps(report: string): string {
  return report.split('\n').filter(line => !/^📅 /u.test(line) && !/^🕒 Diupload:/u.test(line)).join('\n');
}

export function reconciliation(snapshot: Snapshot): string | null {
  const notes: string[] = [];
  if (snapshot.excludedRows) notes.push(`${integer.format(snapshot.excludedRows)} tiket di luar 4 branch`);
  if (snapshot.duplicateRows) notes.push(`${integer.format(snapshot.duplicateRows)} baris duplikat (INCIDENT sama, baris terakhir digunakan)`);
  if (snapshot.filteredRows) notes.push(`${integer.format(snapshot.filteredRows)} tiket non-UNSPEC atau berstatus selesai`);
  return notes.length ? `ℹ️ Catatan pemrosesan: ${notes.join('; ')}. Tidak dimasukkan ke saldo laporan.` : null;
}
