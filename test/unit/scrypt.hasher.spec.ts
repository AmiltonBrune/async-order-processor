import { ScryptPasswordHasher } from '../../src/infrastructure/security/hashing/scrypt.hasher';

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  it('faz ida e volta: o hash gerado verifica a senha original', async () => {
    const hash = await hasher.hash('cliente123');
    await expect(hasher.verify('cliente123', hash)).resolves.toBe(true);
  });

  it('gera hash diferente para a mesma senha', async () => {
    const [a, b] = await Promise.all([hasher.hash('cliente123'), hasher.hash('cliente123')]);
    expect(a).not.toBe(b);
    await expect(hasher.verify('cliente123', a)).resolves.toBe(true);
    await expect(hasher.verify('cliente123', b)).resolves.toBe(true);
  });

  it('recusa senha errada', async () => {
    const hash = await hasher.hash('cliente123');
    await expect(hasher.verify('errada', hash)).resolves.toBe(false);
  });

  it.each([
    ['vazio', ''],
    ['sem prefixo', 'abc$def'],
    ['de outro algoritmo', 'argon2$sal$hash'],
    ['truncado', 'scrypt$apenas-sal'],
  ])('devolve false para hash %s, sem lançar', async (_caso, hash) => {
    await expect(hasher.verify('cliente123', hash)).resolves.toBe(false);
  });

  it('o hash determinístico do seed confere com a senha semeada', async () => {
    const hash = await ScryptPasswordHasher.hashWithSalt('admin123', '00112233445566778899aabbccddeeff');
    await expect(hasher.verify('admin123', hash)).resolves.toBe(true);
    await expect(hasher.verify('outra', hash)).resolves.toBe(false);
  });
});
