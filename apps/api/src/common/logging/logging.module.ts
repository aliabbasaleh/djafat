import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CORRELATION_ID_HEADER } from '@djafat/config';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';

/**
 * Structured logging (pino) + per-request correlation id. Every log line and
 * every error response carries the same `traceId` (docs/05 §5.4).
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const isDev = config.get('NODE_ENV') === 'development';
        const pinoHttp: Record<string, unknown> = {
          level: config.get('LOG_LEVEL'),
          genReqId: (
            req: { headers: Record<string, unknown> },
            res: { setHeader: (k: string, v: string) => void },
          ) => {
            const incoming =
              (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? randomUUID();
            res.setHeader(CORRELATION_ID_HEADER, incoming);
            return incoming;
          },
          customProps: (req: { id?: string }) => ({ traceId: req.id }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["idempotency-key"]',
              '*.password',
              '*.otp',
              '*.code',
              '*.token',
              '*.secret',
            ],
            censor: '[redacted]',
          },
        };
        if (isDev) {
          pinoHttp['transport'] = {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
          };
        }
        return { pinoHttp };
      },
    }),
  ],
})
export class LoggingModule {}
