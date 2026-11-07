import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/telegram.js';
import { Store, type Job } from '../src/store.js';
import { Telegram } from '../src/telegram.js';
import type { ApiRequest, ApiResponse } from '../src/http.js';
import type { OutgoingMessage } from '../src/messages.js';
import type { ReportType } from '../src/menu.js';

test('ordinary messages, unrelated photos/media, and unknown/foreign commands are silent in groups and private chats', async t => {
  const original = { ...process.env };
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: '777:test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected' });
  const getJob = t.mock.method(Store.prototype, 'getJob', async () => { throw new Error('Ignored messages must not query jobs'); });
  const prepare = t.mock.method(Store.prototype, 'prepareMessages', async () => { throw new Error('Ignored messages must not create replies'); });
  const send = t.mock.method(Telegram.prototype, 'send', async () => { throw new Error('Must remain silent'); });
  t.mock.method(Telegram.prototype, 'getUsername', async () => 'reportsulbagsel_bot');
  const run = async (chat: number, payload: object, callback?: string) => {
    let status = 0;
    const response = { setHeader() {}, status(code: number) { status=code;return this; }, json() {} } as unknown as ApiResponse;
    const message = { message_id: 1, date: 1793940000, from: { id: 100 }, chat: { id: chat }, ...payload };
    const body = callback ? { update_id: 1, callback_query: { id: 'test', from: { id: 100 }, data: callback, message } } : { update_id: 1, message };
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' }, body } as unknown as ApiRequest, response);
    return status;
  };
  try {
    for (const chat of [100,-100123]) {
      for (const payload of [
        { text: 'Reload cukup tinggal Sabtu ini' },{ text: 'halo' },{ text: '/unknown' },{ text: '/help@OtherBot' },
        { text: 'terima kasih', reply_to_message: { from: { id: 777, is_bot: true }, chat: { id: chat }, text: 'laporan' } },
        { photo: [{ file_id: 'photo', width: 100, height: 100 }] },
        { photo: [{ file_id: 'photo', width: 100, height: 100 }], reply_to_message: { from: { id: 888, is_bot: true }, chat: { id: chat }, text: '📊 SUMMARY PERFORMANSI UNSPEC – BRANCH BONE\nSALDO (H): 1' } },
        { photo: [{ file_id: 'photo', width: 100, height: 100 }], reply_to_message: { from: { id: 777, is_bot: true }, chat: { id: chat }, text: '📖 PANDUAN SINGKAT' } },
        { document: { file_id: 'doc', file_name: 'notes.pdf' } },{ sticker: { file_id: 'sticker' } },{ voice: { file_id: 'voice' } },
      ]) assert.equal(await run(chat,payload),200);
      assert.equal(await run(chat,{},'unknown:callback'),200);
    }
    assert.equal(getJob.mock.callCount(),0);assert.equal(prepare.mock.callCount(),0);assert.equal(send.mock.callCount(),0);
  } finally { for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original); }
});

test('report documents require matching upload intent, while prepared upload retries can resume', async t => {
  const original = { ...process.env };
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: '777:test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected' });
  let upload: ReportType | null = null;const jobs=new Map<number,Job>();
  t.mock.method(Store.prototype,'getJob',async(id:number)=>jobs.get(id)??null);
  const request=t.mock.method(Store.prototype,'getUploadRequest',async()=>upload);
  const csv=t.mock.method(Telegram.prototype,'downloadCsv',async()=> 'INCIDENT,WORKZONE\nI1,ANT');
  const xlsx=t.mock.method(Telegram.prototype,'downloadXlsx',async()=>{throw new Error('Wrong file must not download')});
  const prepared=t.mock.method(Store.prototype,'prepareUpload',async(id:number,chat:string)=>{upload=null;jobs.set(id,{update_id:String(id),chat_id:chat,messages:['prepared'],delivered:1});});
  const reply=t.mock.method(Store.prototype,'prepareMessages',async(_id:number,_chat:string,_messages:OutgoingMessage[])=>{throw new Error('No unsolicited error messages')});
  const run=async(id:number,name:string)=>{
    let status=0;const response={setHeader(){},status(code:number){status=code;return this;},json(){}} as unknown as ApiResponse;
    await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':'test_secret_12345678'},body:{update_id:id,message:{message_id:id,date:1793940000,from:{id:100},chat:{id:-100123},message_thread_id:42,document:{file_id:'doc',file_name:name}}}} as unknown as ApiRequest,response);
    return status;
  };
  try {
    assert.equal(await run(1,'file.csv'),200);assert.equal(csv.mock.callCount(),0);
    upload='valins_all';assert.equal(await run(2,'file.csv'),200);assert.equal(csv.mock.callCount(),0);
    upload='unspec';assert.equal(await run(3,'file.xlsx'),200);assert.equal(xlsx.mock.callCount(),0);
    assert.equal(await run(4,'file.csv'),200);assert.equal(csv.mock.callCount(),1);assert.equal(prepared.mock.callCount(),1);
    const beforeRetry=request.mock.callCount();assert.equal(await run(4,'file.csv'),200);
    assert.equal(request.mock.callCount(),beforeRetry);assert.equal(csv.mock.callCount(),1);
    assert.equal(await run(5,'unrelated.csv'),200);assert.equal(csv.mock.callCount(),1);assert.equal(reply.mock.callCount(),0);
    assert.deepEqual(request.mock.calls[0]!.arguments,['-100123','100',42]);
  } finally { for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original); }
});
