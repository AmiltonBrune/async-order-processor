import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';

import {
  BusinessRuleViolation,
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from '../../../../domain/shared/errors';
import { CORRELATION_HEADER, LOGGER } from '../../../../infrastructure/observability/correlation.constants';
import { CorrelationContext } from '../../../../infrastructure/observability/correlation.context';
import { StructuredLogger } from '../../../../infrastructure/observability/pino.logger';

export interface ErrorBody {
  readonly code: string;
  readonly message: string;
  readonly correlationId: string | null;
  readonly timestamp: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<{
      status(code: number): { json(body: ErrorBody): void };
    }>();
    const { status, code, message } = this.classify(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('Erro nao tratado na API', {
        erro: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    }

    response.status(status).json({
      code,
      message,
      correlationId: this.correlacaoDe(host),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * O filtro roda DEPOIS que o escopo do interceptor se desfez, então
   * `CorrelationContext.current()` volta nulo em toda resposta de erro — e era
   * justamente aí que o campo servia para alguma coisa. O id sobrevive no
   * request, onde o interceptor o gravou de volta antes de seguir.
   */
  private correlacaoDe(host: ArgumentsHost): string | null {
    const daVez = CorrelationContext.current();
    if (daVez !== undefined && daVez !== null) return daVez;
    const request = host
      .switchToHttp()
      .getRequest<{ headers?: Record<string, unknown> } | undefined>();
    const doRequest = request?.headers?.[CORRELATION_HEADER];
    return typeof doRequest === 'string' && doRequest !== '' ? doRequest : null;
  }

  private classify(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof ValidationError) {
      return { status: HttpStatus.BAD_REQUEST, code: exception.code, message: exception.message };
    }
    if (exception instanceof NotFoundError) {
      return { status: HttpStatus.NOT_FOUND, code: exception.code, message: exception.message };
    }
    if (exception instanceof ConflictError) {
      return { status: HttpStatus.CONFLICT, code: exception.code, message: exception.message };
    }
    if (exception instanceof BusinessRuleViolation) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: exception.code,
        message: exception.message,
      };
    }
    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        code: HttpExceptionFilter.codeOf(exception),
        message: HttpExceptionFilter.messageOf(exception),
      };
    }
    if (exception instanceof DomainError) {
      return { status: HttpStatus.BAD_REQUEST, code: exception.code, message: exception.message };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno',
    };
  }

  private static codeOf(exception: HttpException): string {
    switch (exception.getStatus()) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      default:
        return 'HTTP_ERROR';
    }
  }

  private static messageOf(exception: HttpException): string {
    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    const message = (body as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('; ');
    return typeof message === 'string' ? message : exception.message;
  }
}
