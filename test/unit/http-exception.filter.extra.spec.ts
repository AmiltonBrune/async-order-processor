import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

import { ConflictError, DomainError } from '../../src/domain/shared/errors';
import { ErrorBody, HttpExceptionFilter } from '../../src/interface/http/common/filters/http-exception.filter';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';
import { CorrelationContext } from '../../src/infrastructure/observability/correlation.context';

const capturar = (
  headers: Record<string, unknown> = {},
): { host: ArgumentsHost; corpo: () => ErrorBody; status: () => number } => {
  let statusRecebido = 0;
  let corpoRecebido: ErrorBody | null = null;
  const response = {
    status: (code: number) => {
      statusRecebido = code;
      return { json: (body: ErrorBody) => { corpoRecebido = body; } };
    },
  };
  return {
    host: {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ headers }) }),
    } as unknown as ArgumentsHost,
    corpo: () => corpoRecebido as unknown as ErrorBody,
    status: () => statusRecebido,
  };
};

describe('HttpExceptionFilter — casos de borda', () => {
  const logger = new StructuredLogger('silent', 'test');
  const filtro = new HttpExceptionFilter(logger);

  it('aceita HttpException com corpo em string', () => {
    const alvo = capturar();
    filtro.catch(new HttpException('mensagem direta', HttpStatus.BAD_REQUEST), alvo.host);
    expect(alvo.corpo().message).toBe('mensagem direta');
  });

  it('cai para a mensagem da exceção quando o corpo não traz `message`', () => {
    const alvo = capturar();
    filtro.catch(new HttpException({ erro: 'formato inesperado' }, HttpStatus.CONFLICT), alvo.host);
    expect(alvo.corpo().code).toBe('CONFLICT');
    expect(alvo.corpo().message).toBeTruthy();
  });

  it.each([
    [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
    [HttpStatus.I_AM_A_TEAPOT, 'HTTP_ERROR'],
  ])('traduz o status %i para o código %s', (status, code) => {
    const alvo = capturar();
    filtro.catch(new HttpException('x', status), alvo.host);
    expect(alvo.corpo().code).toBe(code);
  });

  it('registra no log apenas os erros 5xx', () => {
    const registrar = jest.spyOn(logger, 'error');
    filtro.catch(new ConflictError('ORDER_NOT_REPROCESSABLE', 'x'), capturar().host);
    expect(registrar).not.toHaveBeenCalled();

    filtro.catch(new Error('explodiu'), capturar().host);
    expect(registrar).toHaveBeenCalledWith('Erro nao tratado na API', expect.objectContaining({
      erro: 'explodiu',
    }));
    registrar.mockRestore();
  });

  it('registra erro não-Error sem quebrar', () => {
    const registrar = jest.spyOn(logger, 'error');
    const alvo = capturar();
    filtro.catch('string solta', alvo.host);
    expect(alvo.status()).toBe(500);
    expect(registrar).toHaveBeenCalledWith('Erro nao tratado na API', expect.objectContaining({
      erro: 'string solta',
      stack: undefined,
    }));
    registrar.mockRestore();
  });

  it('subclasse nova de DomainError vira 400 com o código dela, não 500', () => {
    class ErroNovoDeDominio extends DomainError {
      constructor() {
        super('VALIDATION_ERROR', 'regra nova ainda não mapeada');
      }
    }
    const alvo = capturar();
    filtro.catch(new ErroNovoDeDominio(), alvo.host);
    expect(alvo.status()).toBe(400);
    expect(alvo.corpo().code).toBe('VALIDATION_ERROR');
  });

  it('inclui o correlationId corrente no corpo de erro', () => {
    const alvo = capturar();
    CorrelationContext.run('corr-erro', () => {
      filtro.catch(new ConflictError('ORDER_NOT_REPROCESSABLE', 'x'), alvo.host);
    });
    expect(alvo.corpo().correlationId).toBe('corr-erro');
  });
});
