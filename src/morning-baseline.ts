import { witaDate, type Snapshot } from './report.js';

export interface ReportMorningBaseline { snapshot: Snapshot; capturedAt: string }

export function isMorningBaselineTime(value: string, date: string): boolean {
  const captured = new Date(value);
  return Number.isFinite(captured.valueOf()) && captured.getUTCHours() === 0 && captured.getUTCMinutes() < 5
    && witaDate(captured.valueOf() / 1000) === date;
}
