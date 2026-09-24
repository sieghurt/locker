import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { API_PREFIX, configureApp, mountSwagger } from './app.setup';
import { EnvironmentVariables, placeholderSecretsIn } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  configureApp(app, { trustProxy: config.get('TRUST_PROXY', { infer: true }) });
  mountSwagger(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  // A signed session cookie is only as good as its secret: anyone who knows it can mint an admin session.
  const placeholders = placeholderSecretsIn(config as unknown as EnvironmentVariables);
  if (placeholders.length > 0) {
    logger.warn(
      `${placeholders.join(', ')} still hold the development placeholder value. Set real secrets ` +
        'before exposing this service to anyone else (for example over a tunnel).',
    );
  }
  logger.log(`Listening on http://localhost:${port}/${API_PREFIX} (docs at /${API_PREFIX}/docs)`);
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'Failed to start',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
