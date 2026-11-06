import 'dotenv/config';
import { database, Store } from '../src/store.js';
import { areaBalances, morningBalances, unspecOperationalDate } from '../src/morning-baseline.js';
import { validDate } from '../src/report.js';

const date = process.argv[2] || unspecOperationalDate(Date.now() / 1000);
if (!validDate(date)) throw new Error('Gunakan tanggal YYYY-MM-DD.');
const sql = database(process.env.DATABASE_URL || '');
try {
  const opening = await new Store(sql).backfillUnspecOpening(date);
  console.log(JSON.stringify({ date, available: !!opening, capturedAt: opening?.capturedAt || null, source: opening?.source || null,
    total: opening ? Object.values(areaBalances(morningBalances(opening))).reduce((sum, value) => sum + value, 0) : null }));
} finally { await sql.end(); }
