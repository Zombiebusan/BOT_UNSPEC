export interface InlineKeyboardMarkup {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface RichMessage {
  type?: 'text';
  text: string;
  reply_markup?: InlineKeyboardMarkup;
  reply_parameters?: ReplyParameters;
}

export interface ReplyParameters {
  message_id: number;
  allow_sending_without_reply?: boolean;
}

export interface PhotoMessage {
  type: 'photo';
  photo: string;
  caption?: string;
  reply_parameters?: ReplyParameters;
}

// Strings keep jobs prepared by earlier deployments readable during upgrades.
export type OutgoingMessage = string | RichMessage | PhotoMessage;
