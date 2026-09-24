import { ExecutionContext } from '@nestjs/common';

import { CORRELATION_HEADER } from '../../src/infrastructure/observability/correlation.constants';
import { lerCorrelationId } from '../../src/interface/http/common/decorators/correlation-id.decorator';

const contexto = (request: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('@CorrelationId()', () => {
  it('entrega o id que o interceptor gravou no request', () => {
    expect(lerCorrelationId(contexto({ headers: { [CORRELATION_HEADER]: 'corr-9' } }))).toBe('corr-9');
  });

  it.each([
    ['requisição sem o header', { headers: {} }],
    ['requisição sem headers', {}],
    ['header que não é texto', { headers: { [CORRELATION_HEADER]: 42 } }],
    ['sem request algum', undefined],
  ])('devolve string vazia em vez de inventar um id — %s', (_caso, request) => {
    expect(lerCorrelationId(contexto(request))).toBe('');
  });
});
