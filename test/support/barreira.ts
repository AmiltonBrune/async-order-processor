export async function largarJuntas<T>(tarefas: ReadonlyArray<() => Promise<T>>): Promise<
  Array<PromiseSettledResult<T>>
> {
  let abrir: () => void = () => undefined;
  const largada = new Promise<void>((resolve) => {
    abrir = resolve;
  });

  const emVoo = tarefas.map(async (tarefa) => {
    await largada;
    return tarefa();
  });

  await new Promise((resolve) => setImmediate(resolve));
  abrir();
  return Promise.allSettled(emVoo);
}
