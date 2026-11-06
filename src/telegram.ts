import { InputError, MAX_CSV_BYTES } from './report.js';
import { MAX_XLSX_BYTES } from './valins.js';
import type { OutgoingMessage } from './messages.js';

export interface TelegramMessage {
  message_id: number;
  date: number;
  message_thread_id?: number;
  from?: { id: number; is_bot?: boolean };
  chat: { id: number; type?: string };
  text?: string;
  caption?: string;
  photo?: { file_id: string; width: number; height: number; file_size?: number }[];
  reply_to_message?: TelegramMessage;
  document?: { file_id: string; file_name?: string; file_size?: number };
}
export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; is_bot?: boolean };
  message?: TelegramMessage;
  data?: string;
}
export interface TelegramUpdate { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }

interface ApiResponse<T> { ok: boolean; result: T; error_code?: number; parameters?: { retry_after?: number; migrate_to_chat_id?: number } }
export class TelegramError extends Error {
  constructor(public readonly code: number, public readonly retryAfter?: number, public readonly migrateToChatId?: number) {
    // Do not include Telegram response descriptions or token-bearing URLs in logs.
    super(`Telegram API gagal (kode ${code}).`);
  }
}

export class Telegram {
  constructor(private readonly token: string) {}

  async call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST', ...(body instanceof FormData ? {} : { headers: { 'Content-Type': 'application/json' } }),
        body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new TelegramError(503);
    }
    let payload: ApiResponse<T>;
    try { payload = await response.json() as ApiResponse<T>; }
    catch { throw new TelegramError(response.status || 502); }
    if (!response.ok || !payload.ok) throw new TelegramError(payload.error_code ?? response.status, payload.parameters?.retry_after, payload.parameters?.migrate_to_chat_id);
    return payload.result;
  }

  async send(chatId: string, message: OutgoingMessage, threadId?: number): Promise<void> {
    const context = {
      chat_id: chatId,
      ...(threadId ? { message_thread_id: threadId } : {}),
      ...(typeof message !== 'string' && message.reply_parameters ? { reply_parameters: message.reply_parameters } : {})
    };
    if (typeof message !== 'string' && message.type === 'photo') {
      if (message.upload) {
        const form = new FormData();
        form.set('chat_id', chatId);
        if (threadId) form.set('message_thread_id', String(threadId));
        if (message.caption) form.set('caption', message.caption);
        if (message.reply_parameters) form.set('reply_parameters', JSON.stringify(message.reply_parameters));
        form.set('photo', new Blob([new Uint8Array(Buffer.from(message.upload.base64, 'base64'))], { type: 'image/png' }), message.upload.filename);
        await this.call('sendPhoto', form);
        return;
      }
      await this.call('sendPhoto', {
        ...context, photo: message.photo,
        ...(message.caption ? { caption: message.caption } : {})
      });
      return;
    }
    await this.call('sendMessage', {
      ...context, text: typeof message === 'string' ? message : message.text,
      ...(typeof message === 'string' || !message.parse_mode ? {} : { parse_mode: message.parse_mode }),
      ...(typeof message === 'string' || !message.reply_markup ? {} : { reply_markup: message.reply_markup })
    });
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    try { await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }); }
    catch (error) {
      // Expired/already acknowledged callbacks must not block a queued menu action.
      if (!(error instanceof TelegramError) || error.code !== 400) throw error;
    }
  }

  async downloadCsv(document: NonNullable<TelegramMessage['document']>): Promise<string> {
    const bytes = await this.downloadDocument(document, '.csv', 'CSV', MAX_CSV_BYTES);
    try {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new InputError('Encoding CSV tidak didukung. Simpan ulang sebagai CSV UTF-8.');
    }
  }

  async downloadXlsx(document: NonNullable<TelegramMessage['document']>): Promise<Buffer> {
    return this.downloadDocument(document, '.xlsx', 'Excel', MAX_XLSX_BYTES);
  }

  private async downloadDocument(document: NonNullable<TelegramMessage['document']>, extension: string, label: string, maximum: number): Promise<Buffer> {
    if (!document.file_name?.toLowerCase().endsWith(extension)) throw new InputError(`Kirim file berekstensi ${extension} sebagai dokumen.`);
    if ((document.file_size ?? 0) > maximum) throw new InputError(`Ukuran ${label} maksimal 10 MB.`);
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: document.file_id });
    if (!file.file_path) throw new TelegramError(502);
    if ((file.file_size ?? 0) > maximum) throw new InputError(`Ukuran ${label} maksimal 10 MB.`);
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, {
        signal: AbortSignal.timeout(10000)
      });
    } catch { throw new TelegramError(503); }
    if (!response.ok || !response.body) throw new TelegramError(response.status || 502);
    // Stream with a hard cap, even when Telegram omits the declared file size.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          throw new InputError(`Ukuran ${label} maksimal 10 MB.`);
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new TelegramError(503);
    }
    return Buffer.concat(chunks);
  }
}
