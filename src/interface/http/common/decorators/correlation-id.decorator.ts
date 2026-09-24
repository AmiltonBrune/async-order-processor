import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { CORRELATION_HEADER } from '../../../../infrastructure/observability/correlation.constants';

export const lerCorrelationId = (context: ExecutionContext): string => {
  const request = context
    .switchToHttp()
    .getRequest<{ headers?: Record<string, unknown> } | undefined>();
  const bruto = request?.headers?.[CORRELATION_HEADER];
  return typeof bruto === 'string' ? bruto : '';
};

export const CorrelationId = createParamDecorator((_dados: unknown, context: ExecutionContext) =>
  lerCorrelationId(context),
);
