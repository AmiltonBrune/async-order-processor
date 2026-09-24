import { World } from './world';

export function useWorld(): () => World {
  let world: World;
  beforeAll(async () => {
    world = await World.boot();
  });
  beforeEach(async () => {
    await world.reset();
  });
  afterAll(async () => {
    await World.shutdown();
  });
  return () => world;
}

export const CATALOGO_PADRAO = [
  { nome: 'Teclado', preco: '10.00', estoque: 5 },
  { nome: 'Mouse', preco: '3.33', estoque: 5 },
];
