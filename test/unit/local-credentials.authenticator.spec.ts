import { LocalCredentialsAuthenticator } from '../../src/infrastructure/security/authentication/local-credentials.authenticator';
import { UserRole } from '../../src/domain/user/user-role.enum';
import {
  FakePasswordHasher,
  FakeTokenIssuer,
  InMemoryDatabase,
  InMemoryUserRepository,
} from '../support/in-memory';

const montar = () => {
  const db = new InMemoryDatabase();
  db.seedUser('cliente@loja.test', 'hash:cliente123', UserRole.CUSTOMER);
  const hasher = new FakePasswordHasher();
  const issuer = new FakeTokenIssuer();
  return {
    hasher,
    issuer,
    autenticador: new LocalCredentialsAuthenticator(new InMemoryUserRepository(db), hasher, issuer),
  };
};

describe('LocalCredentialsAuthenticator', () => {
  it('emite token com o papel do usuário', async () => {
    const { autenticador, issuer } = montar();
    const token = await autenticador.authenticate('cliente@loja.test', 'cliente123');
    expect(token?.accessToken).toContain('CUSTOMER');
    expect(issuer.issued).toEqual([{ subject: 'user-1', role: 'CUSTOMER' }]);
  });

  it('devolve null — e não exceção — quando a senha não confere', async () => {
    const { autenticador, issuer } = montar();
    await expect(autenticador.authenticate('cliente@loja.test', 'errada')).resolves.toBeNull();
    expect(issuer.issued).toHaveLength(0);
  });

  it('verifica um hash mesmo sem usuário, para não vazar pelo tempo de resposta', async () => {
    const { autenticador, hasher } = montar();
    await expect(autenticador.authenticate('naoexiste@loja.test', 'x')).resolves.toBeNull();
    expect(hasher.calls).toHaveLength(1);
  });
});
