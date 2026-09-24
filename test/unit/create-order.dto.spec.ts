import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateOrderDto } from '../../src/interface/http/orders/dto/create-order.dto';

const validar = async (corpo: unknown): Promise<string[]> => {
  const dto = plainToInstance(CreateOrderDto, corpo);
  const erros = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return erros.flatMap((erro) => [
    erro.property,
    ...(erro.children ?? []).flatMap((filho) =>
      (filho.children ?? []).map((neto) => neto.property),
    ),
  ]);
};

const valido = {
  customerName: 'Ana Souza',
  items: [{ productName: 'Teclado', quantity: 2, price: '10.00' }],
};

describe('CreateOrderDto', () => {
  it('aceita um pedido bem formado', async () => {
    expect(await validar(valido)).toEqual([]);
  });

  it.each([
    ['lista de itens vazia', { ...valido, items: [] }],
    ['sem nome de cliente', { ...valido, customerName: '' }],
    ['nome de cliente longo demais', { ...valido, customerName: 'x'.repeat(161) }],
  ])('recusa %s', async (_caso, corpo) => {
    expect(await validar(corpo)).not.toEqual([]);
  });

  it.each([
    ['quantidade zero', 0],
    ['quantidade negativa', -1],
    ['quantidade fracionária', 1.5],
  ])('recusa item com %s', async (_caso, quantity) => {
    const erros = await validar({ ...valido, items: [{ ...valido.items[0], quantity }] });
    expect(erros).toContain('quantity');
  });

  it.each([
    ['negativo', '-10.00'],
    ['com três casas', '10.001'],
    ['com vírgula', '10,00'],
    ['não numérico', 'dez reais'],
    ['vazio', ''],
  ])('recusa preço %s', async (_caso, price) => {
    const erros = await validar({ ...valido, items: [{ ...valido.items[0], price }] });
    expect(erros).toContain('price');
  });

  it.each(['0.01', '10.00', '9999999999.99', '5'])('aceita preço %s', async (price) => {
    const erros = await validar({ ...valido, items: [{ ...valido.items[0], price }] });
    expect(erros).not.toContain('price');
  });

  it('recusa preço enviado como número', async () => {
    const erros = await validar({ ...valido, items: [{ ...valido.items[0], price: 10.0 }] });
    expect(erros).toContain('price');
  });
});
