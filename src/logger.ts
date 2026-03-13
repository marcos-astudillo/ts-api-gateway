import pino from 'pino';
import { env } from './config/env';

/**
 * Structured logger using pino.
 * In development uses pino-pretty for human-readable output.
 * In production emits newline-delimited JSON — ready for log aggregators
 * (Datadog, Loki, CloudWatch, Railway's log drain, etc.).
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
  base: {
    env: env.NODE_ENV,
    service: 'api-gateway',
  },
  redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
});
