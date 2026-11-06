import { readFile } from 'node:fs/promises';
import { parseSnapshot, previousDate, reconciliation, renderReports, resolveCsvReportDate } from '../src/report.js';

const file = process.argv[2];
if (!file) throw new Error('Gunakan: npm run report:preview -- "lokasi/file.csv" ["csv-hari-sebelumnya.csv"]');
const timestamp = Math.floor(Date.now() / 1000);
const reportDate = resolveCsvReportDate(undefined, timestamp);
const snapshot = parseSnapshot(await readFile(file, 'utf8'), reportDate);
const previous = process.argv[3] ? parseSnapshot(await readFile(process.argv[3], 'utf8'), previousDate(reportDate)) : null;
for (const report of renderReports(snapshot, previous, timestamp, reportDate)) console.log(`${report}\n\n`);
const note = reconciliation(snapshot);
if (note) console.log(note);
