import { readFile, writeFile } from 'node:fs/promises';
import { parseSnapshot, previousDate, resolveCsvReportDate } from '../src/report.js';
import { renderUnspecTablePng } from '../src/unspec-table.js';

const [currentFile, previousFile, requestedDate, output = 'unspec-table-preview.png'] = process.argv.slice(2);
if (!currentFile) throw new Error('Gunakan: npm run unspec:table:preview -- CSV_H [CSV_H1] [YYYY-MM-DD] [output.png]');
const date = requestedDate || resolveCsvReportDate(undefined, Date.now() / 1000);
const current = parseSnapshot(await readFile(currentFile, 'utf8'), date);
const previous = previousFile && previousFile !== '-' ? parseSnapshot(await readFile(previousFile, 'utf8'), previousDate(date)) : null;
await writeFile(output, renderUnspecTablePng(current, previous));
console.log(`Preview tabel: ${output}; tanggal ${date}. Tidak ada pesan Telegram yang dikirim.`);
