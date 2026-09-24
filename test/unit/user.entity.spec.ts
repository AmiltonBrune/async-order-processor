import { User } from '../../src/domain/user/user.entity';
import { UserRole } from '../../src/domain/user/user-role.enum';

describe('User', () => {
  it('reconhece o papel de operador', () => {
    expect(new User('1', 'a@b.test', 'hash', UserRole.ADMIN).isAdmin()).toBe(true);
    expect(new User('2', 'c@d.test', 'hash', UserRole.CUSTOMER).isAdmin()).toBe(false);
  });

  it('guarda o hash, nunca a senha', () => {
    const user = new User('1', 'a@b.test', 'hash-argon2', UserRole.CUSTOMER);
    expect(user.passwordHash).toBe('hash-argon2');
    expect(Object.values(user)).not.toContain('senha-em-claro');
  });
});
