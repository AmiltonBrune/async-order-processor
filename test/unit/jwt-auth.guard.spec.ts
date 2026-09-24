import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../src/interface/http/common/guards/jwt-auth.guard';
import { LocalJwtVerifier } from '../../src/infrastructure/security/tokens/local-jwt.verifier';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';

const SEGREDO = 'segredo-de-teste';
const jwt = new JwtService({ secret: SEGREDO, signOptions: { algorithm: 'HS256' } });

const contexto = (headers: Record<string, unknown>, publico = false) => {
  const request: { headers: Record<string, unknown>; user?: unknown } = { headers };
  const reflector = { getAllAndOverride: () => (publico ? true : undefined) } as unknown as Reflector;
  const execution = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { request, guard: new JwtAuthGuard(reflector, new LocalJwtVerifier(jwt)), execution };
};

describe('LocalJwtVerifier', () => {
  const verificador = new LocalJwtVerifier(jwt);

  it('traduz o papel único do token local para a lista da porta', async () => {
    const token = jwt.sign({ sub: 'user-1', role: 'ADMIN' });
    await expect(verificador.verify(token)).resolves.toEqual({
      subject: 'user-1',
      roles: ['ADMIN'],
    });
  });

  it.each([
    ['sem papel', {}],
    ['com papel vazio', { role: '' }],
    ['com papel não textual', { role: 42 }],
  ])('token %s vira identidade sem papéis, não erro', async (_caso, extra) => {
    const token = jwt.sign({ sub: 'u', ...extra });
    await expect(verificador.verify(token)).resolves.toEqual({ subject: 'u', roles: [] });
  });
});

describe('JwtAuthGuard', () => {
  it('aceita token válido e anexa o usuário ao request', async () => {
    const token = jwt.sign({ sub: 'user-1', role: 'ADMIN' });
    const { guard, execution, request } = contexto({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(execution)).resolves.toBe(true);
    // `roles` é lista porque é assim que um provedor de SSO entrega: no Keycloak
    // o usuário tem N papéis de realm. O guard não sabe qual adaptador está no ar.
    expect(request.user).toEqual({ sub: 'user-1', roles: ['ADMIN'] });
  });

  it('libera rota marcada como pública sem olhar o header', async () => {
    const { guard, execution } = contexto({}, true);
    await expect(guard.canActivate(execution)).resolves.toBe(true);
  });

  it.each([
    ['sem header', {}],
    ['header vazio', { authorization: '' }],
    ['sem o esquema Bearer', { authorization: 'token-solto' }],
    ['esquema errado', { authorization: 'Basic abc' }],
    ['Bearer sem valor', { authorization: 'Bearer ' }],
    ['header não textual', { authorization: 42 }],
  ])('recusa requisição %s', async (_caso, headers) => {
    const { guard, execution } = contexto(headers);
    await expect(guard.canActivate(execution)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token expirado', async () => {
    const token = jwt.sign({ sub: 'u', role: 'CUSTOMER' }, { expiresIn: '-1s' });
    const { guard, execution } = contexto({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(execution)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token assinado com outro segredo', async () => {
    const outro = new JwtService({ secret: 'outro-segredo' });
    const token = outro.sign({ sub: 'u', role: 'ADMIN' });
    const { guard, execution } = contexto({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(execution)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token de emissor desconhecido sem dizer o motivo', async () => {
    // Todo motivo de recusa devolve o MESMO 401. Distinguir "expirado" de
    // "assinatura errada" entrega ao atacante o feedback de que ele precisa.
    const outro = new JwtService({ secret: 'outro-segredo' });
    const { guard, execution } = contexto({ authorization: `Bearer ${outro.sign({ sub: 'u' })}` });
    await expect(guard.canActivate(execution)).rejects.toThrow('Token invalido');
  });

  it('registra o motivo quando o verificador lança algo que não é Error', async () => {
    // O cliente continua recebendo 401 genérico; o log precisa do motivo, seja
    // ele qual for, senão uma integração mal configurada fica indistinguível de
    // token forjado.
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const request: { headers: Record<string, unknown> } = { headers: { authorization: 'Bearer x' } };
    const execution = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    const verificador = {
      verify: async () => {
        throw 'string solta';
      },
    };
    const logger = new StructuredLogger('silent', 'test');
    const registrar = jest.spyOn(logger, 'warn');

    await expect(
      new JwtAuthGuard(reflector, verificador, logger).canActivate(execution),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(registrar).toHaveBeenCalledWith('Token recusado', { motivo: 'string solta' });
    registrar.mockRestore();
  });

  it('funciona sem logger injetado', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const execution = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    await expect(
      new JwtAuthGuard(reflector, { verify: async () => ({ subject: 'u', roles: [] }) }).canActivate(
        execution,
      ),
    ).resolves.toBe(true);
  });

  it('recusa token com payload adulterado', async () => {
    // Trocar o papel para ADMIN e reaproveitar a assinatura é a tentativa óbvia.
    const valido = jwt.sign({ sub: 'u', role: 'CUSTOMER' });
    const [cabecalho, , assinatura] = valido.split('.');
    const adulterado = Buffer.from(JSON.stringify({ sub: 'u', role: 'ADMIN' })).toString('base64url');
    const { guard, execution } = contexto({
      authorization: `Bearer ${[cabecalho, adulterado, assinatura].join('.')}`,
    });
    await expect(guard.canActivate(execution)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
