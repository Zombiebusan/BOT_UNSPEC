import type { IncomingMessage, ServerResponse } from 'node:http';

// Vercel's Node HTTP helpers, typed without requiring its build runtime as a dependency.
export interface ApiRequest extends IncomingMessage { body?: unknown }
export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse;
}
