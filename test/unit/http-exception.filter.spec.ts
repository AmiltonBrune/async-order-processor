import { ArgumentsHost, ForbiddenException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';

import {
  BusinessRuleViolation,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../src/domain/shared/errors';
import { CorrelationContext } from '../../src/infrastructure/observability/correlation.context';
import { ErrorBody, HttpExceptionFilter } from '../../src/interface/http/common/filters/http-exception.filter';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';

const capturar = (
  headers: Record<string, unknown> = {},
): { host: ArgumentsHost; corpo: () => ErrorBody; status: () => number } => {
  let statusRecebido = 0;
  let corpoRecebido: ErrorBody | null = null;
  const response = {
    status: (code: number) => {
      statusRecebido = code;
      return {
        json: (body: ErrorBody) => {
          corpoRecebido = body;
        },
      };
    },
  };
  const request = { headers };
  return {
    host: {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost,
    corpo: () => corpoRecebido as unknown as ErrorBody,
    status: () => statusRecebido,
  };
};

describe('HttpExceptionFilter', () => {
  const filtro = new HttpExceptionFilter(new StructuredLogger('silent', 'test'));

  it.each([
    ['ValidationError', new ValidationError('VALIDATION_ERROR', 'entrada invalida'), 400],
    ['NotFoundError', new NotFoundError('ORDER_NOT_FOUND', 'nao achei'), 404],
    ['ConflictError', new ConflictError('ORDER_NOT_REPROCESSABLE', 'estado errado'), 409],
    [
      'BusinessRuleViolation',
      new BusinessRuleViolation('PRODUCT_NOT_FOUND', 'produto fora do catalogo'),
      422,
    ],
  ])('mapeia %s para %i com o código de domínio', (_nome, erro, status) => {
    const alvo = capturar();
    filtro.catch(erro, alvo.host);
    expect(alvo.status()).toBe(status);
    expect(alvo.corpo().code).toBe((erro as { code: string }).code);
    expect(alvo.corpo().message).toBe(erro.message);
  });

  it.each([
    [new UnauthorizedException('sem token'), 401, 'UNAUTHORIZED'],
    [new ForbiddenException('papel insuficiente'), 403, 'FORBIDDEN'],
    [new HttpException({ message: ['campo a', 'campo b'] }, HttpStatus.BAD_REQUEST), 400, 'VALIDATION_ERROR'],
  ])('traduz exceção HTTP do Nest preservando o status', (erro, status, code) => {
    const alvo = capturar();
    filtro.catch(erro, alvo.host);
    expect(alvo.status()).toBe(status);
    expect(alvo.corpo().code).toBe(code);
  });

  it('junta as mensagens de validação numa linha legível', () => {
    const alvo = capturar();
    filtro.catch(new HttpException({ message: ['campo a', 'campo b'] }, 400), alvo.host);
    expect(alvo.corpo().message).toBe('campo a; campo b');
  });

  it('erro não mapeado vira 500 sem vazar stack nem mensagem original', () => {
    const alvo = capturar();
    filtro.catch(new Error('SELECT * FROM users falhou em /app/src/secreto.ts'), alvo.host);
    expect(alvo.status()).toBe(500);
    expect(alvo.corpo().code).toBe('INTERNAL_ERROR');
    expect(alvo.corpo().message).toBe('Erro interno');
    expect(JSON.stringify(alvo.corpo())).not.toContain('secreto.ts');
  });

  it('todo corpo de erro traz timestamp e o campo de correlação', () => {
    const alvo = capturar();
    filtro.catch(new NotFoundError('ORDER_NOT_FOUND', 'x'), alvo.host);
    expect(alvo.corpo()).toHaveProperty('correlationId');
    expect(Date.parse(alvo.corpo().timestamp)).not.toBeNaN();
  });

  // O filtro roda fora do escopo do interceptor, então o AsyncLocalStorage já
  // voltou vazio quando ele monta o corpo. Sem ler o request, o campo saía
  // `null` em TODA resposta de erro — justo a resposta que o cliente cola no
  // chamado de suporte.
  it('preenche o correlationId a partir do request quando o escopo já se desfez', () => {
    const alvo = capturar({ 'x-correlation-id': 'c0rr-1234' });
    filtro.catch(new NotFoundError('ORDER_NOT_FOUND', 'x'), alvo.host);
    expect(alvo.corpo().correlationId).toBe('c0rr-1234');
  });

  it('prefere o contexto ativo ao header, quando há contexto', async () => {
    await CorrelationContext.run('do-contexto', () => {
      const alvo = capturar({ 'x-correlation-id': 'do-header' });
      filtro.catch(new NotFoundError('ORDER_NOT_FOUND', 'x'), alvo.host);
      expect(alvo.corpo().correlationId).toBe('do-contexto');
    });
  });

  it.each([
    ['sem header nenhum', {}],
    ['header vazio', { 'x-correlation-id': '' }],
    ['header que não é texto', { 'x-correlation-id': 42 }],
  ])('devolve null quando não há correlação confiável — %s', (_caso, headers) => {
    const alvo = capturar(headers);
    filtro.catch(new NotFoundError('ORDER_NOT_FOUND', 'x'), alvo.host);
    expect(alvo.corpo().correlationId).toBeNull();
  });

  it('não quebra quando o host não expõe request algum', () => {
    const response = {
      status: () => ({ json: (body: ErrorBody) => body }),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => undefined }),
    } as unknown as ArgumentsHost;
    expect(() => filtro.catch(new NotFoundError('ORDER_NOT_FOUND', 'x'), host)).not.toThrow();
  });
});
