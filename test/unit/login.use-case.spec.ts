import { UnauthorizedException } from '@nestjs/common';

import { LoginUseCase } from '../../src/application/login/login.use-case';
import { AccessToken } from '../../src/domain/ports/system/access-token.port';
import { CredentialsAuthenticator } from '../../src/domain/ports/system/credentials-authenticator.port';

class AutenticadorFake implements CredentialsAuthenticator {
  chamadas: Array<{ email: string; password: string }> = [];

  constructor(private readonly resultado: AccessToken | null) {}

  async authenticate(email: string, password: string): Promise<AccessToken | null> {
    this.chamadas.push({ email, password });
    return this.resultado;
  }
}

const TOKEN: AccessToken = { accessToken: 'token-valido', expiresIn: 3600 };

describe('LoginUseCase', () => {
  it('devolve o token quando as credenciais conferem', async () => {
    const autenticador = new AutenticadorFake(TOKEN);
    const useCase = new LoginUseCase(autenticador);

    await expect(useCase.execute('cliente@loja.test', 'cliente123')).resolves.toEqual(TOKEN);
    expect(autenticador.chamadas).toEqual([
      { email: 'cliente@loja.test', password: 'cliente123' },
    ]);
  });

  it.each([
    ['senha errada', 'cliente@loja.test', 'errada'],
    ['usuário inexistente', 'naoexiste@loja.test', 'cliente123'],
  ])('recusa %s com a MESMA mensagem', async (_caso, email, senha) => {
    const useCase = new LoginUseCase(new AutenticadorFake(null));

    await expect(useCase.execute(email, senha)).rejects.toThrow(UnauthorizedException);
    await expect(useCase.execute(email, senha)).rejects.toThrow('Credenciais invalidas');
  });

  it('deixa erro de infraestrutura subir, em vez de virar 401', async () => {
    const quebrado: CredentialsAuthenticator = {
      authenticate: async () => {
        throw new Error('Keycloak respondeu 503');
      },
    };
    await expect(new LoginUseCase(quebrado).execute('a@b.test', 'x')).rejects.toThrow(
      'Keycloak respondeu 503',
    );
  });
});
