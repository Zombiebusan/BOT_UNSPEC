import { readFile } from 'node:fs/promises';
import { parseValinsArguments, parseValinsWorkbook, renderValinsReports } from '../src/valins.js';

const file = process.argv[2];
if (!file) throw new Error('Gunakan: npm run valins:preview -- "file.xlsx" [pare-pare|bone|kendari|makassar|semua]');
const options = parseValinsArguments(process.argv.slice(3));
const snapshot = await parseValinsWorkbook(await readFile(file));
for (const report of renderValinsReports(snapshot, 'all', options.scope)) console.log(`${report}\n\n`);
