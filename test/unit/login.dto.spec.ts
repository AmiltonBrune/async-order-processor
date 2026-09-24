import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { LoginDto } from '../../src/interface/http/auth/dto/login.dto';

const validar = async (corpo: unknown): Promise<string[]> => {
  const erros = await validate(plainToInstance(LoginDto, corpo));
  return erros.map((erro) => erro.property);
};

describe('LoginDto', () => {
  it('aceita as credenciais dos usuários semeados', async () => {
    expect(await validar({ email: 'cliente@loja.test', password: 'cliente123' })).toEqual([]);
    expect(await validar({ email: 'admin@loja.test', password: 'admin123' })).toEqual([]);
  });

  it.each([
    ['sem arroba', 'naoehemail'],
    ['vazio', ''],
    ['só o domínio', '@loja.test'],
    ['com espaço', 'a b@loja.test'],
  ])('recusa e-mail %s', async (_caso, email) => {
    expect(await validar({ email, password: 'x' })).toContain('email');
  });

  it('recusa corpo sem senha', async () => {
    expect(await validar({ email: 'cliente@loja.test' })).toContain('password');
    expect(await validar({})).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('recusa senha vazia', async () => {
    expect(await validar({ email: 'cliente@loja.test', password: '' })).toContain('password');
  });
});
