import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReportPhoto, MAX_PHOTO_CAPTION } from '../src/report-photo.js';
import { InputError } from '../src/report.js';
import type { TelegramMessage } from '../src/telegram.js';

const report = '📊 SUMMARY PERFORMANSI UNSPEC – BRANCH PARE-PARE\n\nSALDO (H): 227\nSALDO (H-1): 263';
function reply(text = report): TelegramMessage {
  return {
    message_id: 99, date: 1793062800, from: { id: 123 }, chat: { id: -100123 },
    caption: 'Caption foto pengguna tidak menggantikan teks laporan.',
    photo: [
      { file_id: 'large', width: 1280, height: 960, file_size: 200000 },
      { file_id: 'small', width: 320, height: 240, file_size: 20000 }
    ],
    reply_to_message: { message_id: 50, date: 1793062700, from: { id: 777, is_bot: true }, chat: { id: -100123 }, text }
  };
}

test('photo reply reuses the highest-resolution file and the exact original report', () => {
  assert.deepEqual(prepareReportPhoto(reply(), '777'), [{
    type: 'photo', photo: 'large', caption: report,
    reply_parameters: { message_id: 99, allow_sending_without_reply: true }
  }]);
});

test('caption boundary retains all text and long reports become photo plus complete text', () => {
  const exact = report.padEnd(MAX_PHOTO_CAPTION, 'x');
  const short = prepareReportPhoto(reply(exact), '777');
  assert.equal(short.length, 1);
  assert.ok(typeof short[0] !== 'string' && short[0]?.type === 'photo' && short[0].caption === exact);
  const long = `${exact}x`;
  const messages = prepareReportPhoto(reply(long), '777');
  assert.equal(messages.length, 2);
  const photo = messages[0], text = messages[1];
  assert.ok(photo && typeof photo !== 'string' && photo.type === 'photo' && photo.caption!.length <= MAX_PHOTO_CAPTION);
  assert.ok(text && typeof text !== 'string' && text.type !== 'photo');
  assert.equal(text.text, long);
  assert.equal(text.reply_parameters?.message_id, 99);
});

test('VALINS reports and existing report photo captions can receive a new image', () => {
  for (const title of [
    '📊 SUMMARY VALINS VISIT ODP (PROV, ASR DAN MAINT) – PARE-PARE',
    '📊 SUMMARY VALINS DC QR CODE & SERVICE – BONE'
  ]) {
    const message = reply(`${title}\n\nTOTAL REAL (H): 94,44%`);
    const text = message.reply_to_message!.text!;
    delete message.reply_to_message!.text;
    message.reply_to_message!.caption = text;
    const outgoing = prepareReportPhoto(message, '777')[0];
    assert.ok(outgoing && typeof outgoing !== 'string' && outgoing.type === 'photo');
    assert.equal(outgoing.caption, text);
  }
});

test('unrelated messages, another bot, missing replies and missing photos are rejected', () => {
  const cases: TelegramMessage[] = [];
  const missingReply = reply(); delete missingReply.reply_to_message; cases.push(missingReply);
  const otherBot = reply(); otherBot.reply_to_message!.from!.id = 888; cases.push(otherBot);
  const userMessage = reply(); userMessage.reply_to_message!.from!.is_bot = false; cases.push(userMessage);
  const otherChat = reply(); otherChat.reply_to_message!.chat.id = 123; cases.push(otherChat);
  cases.push(reply('👋 Selamat datang di Report Sulbagsel!'));
  const noPhoto = reply(); noPhoto.photo = []; cases.push(noPhoto);
  for (const message of cases) assert.throws(() => prepareReportPhoto(message, '777'), InputError);
});
