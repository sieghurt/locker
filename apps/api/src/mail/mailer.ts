export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Outbound email. Bound to SMTP (Mailpit locally, any provider in production) or a logger. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
