import { Injectable, LoggerService } from '@nestjs/common';
import pino, { Logger } from 'pino';

import { CorrelationContext } from './correlation.context';

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly root: Logger;

  constructor(level: string, name: string) {
    this.root = pino({
      level: level === 'silent' ? 'silent' : level,
      base: { service: 'async-order-processor', role: name },
      redact: {
        paths: [
          'password',
          'senha',
          'authorization',
          'req.headers.authorization',
          'accessToken',
          'passwordHash',
        ],
        censor: '[REDACTED]',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  log(message: string, context?: Record<string, unknown>): void {
    this.root.info(this.enrich(context), message);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.root.error(this.enrich(context), message);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.root.warn(this.enrich(context), message);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.root.debug(this.enrich(context), message);
  }

  verbose(message: string, context?: Record<string, unknown>): void {
    this.root.trace(this.enrich(context), message);
  }

  private enrich(context?: Record<string, unknown>): Record<string, unknown> {
    const correlationId = CorrelationContext.current();
    const orderId = CorrelationContext.currentOrderId();
    return {
      ...context,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(orderId === undefined ? {} : { orderId }),
    };
  }
}

