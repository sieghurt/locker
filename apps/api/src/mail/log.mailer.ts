import { Logger } from '@nestjs/common';

import { MailMessage, Mailer } from './mailer';

/**
 * Used when no MAIL_HOST is configured. Nobody receives anything, but the service keeps working and the
 * operator can see that a message would have gone out. Neither the body nor the subject is logged:
 * both can carry a credential (a login code).
 */
export class LogMailer extends Mailer {
  private readonly logger = new Logger(LogMailer.name);

  async send(message: MailMessage): Promise<void> {
    this.logger.warn(
      `MAIL_HOST is not set; an email to *@${message.to.split('@')[1] ?? '?'} was not sent`,
    );
    await Promise.resolve();
  }
}
