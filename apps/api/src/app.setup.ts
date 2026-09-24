import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

/**
 * Global HTTP behaviour shared by `main.ts` and the e2e suite so tests exercise exactly what
 * production runs: strict input validation, one response envelope, one error envelope.
 */
/** Every route lives under this prefix so a reverse proxy can route `/api/*` to this service. */
export const API_PREFIX = 'api';

export function configureApp(app: INestApplication, options: { trustProxy?: boolean } = {}): void {
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  if (options.trustProxy) {
    // Behind a reverse proxy every request arrives from the proxy's IP; honour X-Forwarded-For so
    // the per-IP rate limits apply to the client rather than to the whole station.
    (app as NestExpressApplication).set('trust proxy', 1);
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.enableShutdownHooks();
}

export function mountSwagger(app: INestApplication, path = `${API_PREFIX}/docs`): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Smart Package Locker API')
      .setDescription(
        'Delivery agents store packages; the system assigns the smallest fitting locker and issues a ' +
          'pickup code. Customers retrieve with locker id + code and are charged for extended storage.\n\n' +
          '**Envelope:** every response body is `{ "success": true, "data": <schema below> }` on success ' +
          'or `{ "success": false, "error": { "code", "message", "details?" } }` on failure. The schemas ' +
          'documented per endpoint describe the `data` field.',
      )
      .setVersion('1.0')
      .addCookieAuth('sid')
      .build(),
  );
  SwaggerModule.setup(path, app, document);
}
