import { CORRELATION_HEADER } from '../../src/infrastructure/observability/correlation.constants';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import { CorrelationIdInterceptor } from '../../src/infrastructure/observability/correlation-id.interceptor';
import { CorrelationContext } from '../../src/infrastructure/observability/correlation.context';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';

const contexto = (headers: Record<string, unknown>) => {
  const response = { setHeader: jest.fn(), statusCode: 201 };
  const request = { headers, method: 'POST', url: '/orders' };
  return {
    response,
    request,
    execution: {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext,
  };
};

const proximo = (captura: { id?: string }): CallHandler => ({
  handle: () => {
    captura.id = CorrelationContext.current();
    return of('ok');
  },
});

describe('CorrelationIdInterceptor', () => {
  const logger = new StructuredLogger('silent', 'test');
  const interceptor = new CorrelationIdInterceptor(logger);

  it('respeita o correlationId enviado pelo cliente', () => {
    const { execution, response } = contexto({ [CORRELATION_HEADER]: 'do-cliente' });
    const captura: { id?: string } = {};

    interceptor.intercept(execution, proximo(captura));

    expect(captura.id).toBe('do-cliente');
    expect(response.setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, 'do-cliente');
  });

  it('gera um id quando o cliente não manda', () => {
    const { execution, request } = contexto({});
    const captura: { id?: string } = {};

    interceptor.intercept(execution, proximo(captura));

    expect(captura.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.headers[CORRELATION_HEADER]).toBe(captura.id);
  });

  it('sempre devolve o id no header da resposta', () => {
    const { execution, response } = contexto({});
    interceptor.intercept(execution, proximo({}));
    expect(response.setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, expect.any(String));
  });

  it('registra uma linha de log por requisição, com rota e status', () => {
    const registrar = jest.spyOn(logger, 'log');
    const { execution } = contexto({});
    (interceptor.intercept(execution, proximo({})) as { subscribe: (f: unknown) => void }).subscribe(
      () => undefined,
    );
    expect(registrar).toHaveBeenCalledWith('Requisicao concluida', expect.objectContaining({
      rota: expect.anything(),
      status: expect.anything(),
    }));
    registrar.mockRestore();
  });

  it('ignora header vazio ou de tipo inesperado', () => {
    for (const valor of ['   ', 42, null, undefined]) {
      const { execution } = contexto({ [CORRELATION_HEADER]: valor });
      const captura: { id?: string } = {};
      interceptor.intercept(execution, proximo(captura));
      expect(captura.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
