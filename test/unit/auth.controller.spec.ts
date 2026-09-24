import { UnauthorizedException } from '@nestjs/common';

import { AuthController } from '../../src/interface/http/auth/auth.controller';

describe('AuthController', () => {
  it('repassa e-mail e senha ao caso de uso e devolve o token', async () => {
    const login = { execute: jest.fn(async () => ({ accessToken: 'token', expiresIn: 3600 })) };
    const controller = new AuthController(login as never);

    const resposta = await controller.authenticate({
      email: 'cliente@loja.test',
      password: 'cliente123',
    });

    expect(login.execute).toHaveBeenCalledWith('cliente@loja.test', 'cliente123');
    expect(resposta).toEqual({ accessToken: 'token', expiresIn: 3600 });
  });

  it('não converte a recusa do caso de uso em outra coisa', async () => {
    const login = {
      execute: jest.fn(async () => {
        throw new UnauthorizedException('Credenciais invalidas');
      }),
    };
    await expect(
      new AuthController(login as never).authenticate({ email: 'a@b.test', password: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
