export const DEFAULT_MAILS_PER_MINUTE = 55;
export const DEFAULT_MAILS_PER_SECOND = 8;
export const MAX_MAILS_PER_MINUTE = 200;
export const MAX_MAILS_PER_SECOND = 20;

export interface MailLimits {
  mailsPerMinute: number;
  mailsPerSecond: number;
}
