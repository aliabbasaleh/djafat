import pino, { type LoggerOptions } from 'pino';
import { loadWorkerEnv } from '@djafat/config';

const env = loadWorkerEnv();

const options: LoggerOptions = { level: env.LOG_LEVEL };
if (env.NODE_ENV === 'development') {
  options.transport = { target: 'pino-pretty', options: { singleLine: true } };
}

export const logger = pino(options);

export { env };
