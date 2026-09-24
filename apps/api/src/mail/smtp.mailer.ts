import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { MailMessage, Mailer } from './mailer';

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Sends through any SMTP server: the Mailpit container in development, a real provider in production. */
export class SmtpMailer extends Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpOptions) {
    super();
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.user ? { user: options.user, pass: options.password ?? '' } : undefined,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.options.from, ...message });
    // Nothing from the message itself is logged: the address is personal data and the subject can
    // carry a credential (a login code). The recipient's domain is enough to debug delivery.
    this.logger.log(`Sent an email to *@${message.to.split('@')[1] ?? '?'}`);
  }
}
