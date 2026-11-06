import type { ApiRequest, ApiResponse } from '../src/http.js';

export default function handler(_req: ApiRequest, res: ApiResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, service: 'kkp-unspec-telegram-bot' });
}
