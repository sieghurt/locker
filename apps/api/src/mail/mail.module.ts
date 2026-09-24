import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../config/environment';
import { LogMailer } from './log.mailer';
import { Mailer } from './mailer';
import { SmtpMailer } from './smtp.mailer';

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): Mailer => {
        const host = config.get('MAIL_HOST', { infer: true });
        if (!host) return new LogMailer();
        return new SmtpMailer({
          host,
          port: config.get('MAIL_PORT', { infer: true }),
          secure: config.get('MAIL_SECURE', { infer: true }),
          user: config.get('MAIL_USER', { infer: true }) || undefined,
          password: config.get('MAIL_PASSWORD', { infer: true }) || undefined,
          from: config.get('MAIL_FROM', { infer: true }),
        });
      },
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
