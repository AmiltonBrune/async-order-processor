import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ListOrdersDto } from '../../src/interface/http/orders/dto/list-orders.dto';

const validar = async (query: unknown): Promise<{ dto: ListOrdersDto; erros: string[] }> => {
  const dto = plainToInstance(ListOrdersDto, query);
  const erros = await validate(dto);
  return { dto, erros: erros.map((erro) => erro.property) };
};

describe('ListOrdersDto', () => {
  it('sem parâmetros usa página 1 e limite 20', async () => {
    const { dto, erros } = await validar({});
    expect(erros).toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('converte os números que chegam como string na query', async () => {
    const { dto, erros } = await validar({ page: '3', limit: '50' });
    expect(erros).toEqual([]);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
  });

  it.each([['0'], ['-1'], ['abc'], ['1.5']])('recusa página %s', async (page) => {
    expect((await validar({ page })).erros).toContain('page');
  });

  it.each([['0'], ['101'], ['1000000'], ['abc']])('recusa limite %s', async (limit) => {
    expect((await validar({ limit })).erros).toContain('limit');
  });

  it('aceita exatamente o teto', async () => {
    expect((await validar({ limit: '100' })).erros).toEqual([]);
  });

  it.each([['PENDING'], ['PROCESSED'], ['FAILED']])('aceita o status %s', async (status) => {
    expect((await validar({ status })).erros).toEqual([]);
  });

  it('recusa status fora do enum', async () => {
    expect((await validar({ status: 'BANANA' })).erros).toContain('status');
  });
});
