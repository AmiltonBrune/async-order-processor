import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Async Order Processor')
      .setDescription(
        [
          'Pedidos com processamento assíncrono: a API aceita o pedido e responde na hora; a',
          'validação e a reserva de estoque acontecem fora do ciclo da requisição, consumidas de',
          'uma fila real, com retentativa, dead-letter e proteção contra *overselling*.',
          '',
          '### Como testar tudo daqui, em ordem',
          '',
          '1. **`POST /auth/login`** com `cliente@loja.test` / `cliente123` (há um exemplo pronto).',
          '2. Copie o `accessToken` e clique em **Authorize** (cadeado, canto superior direito).',
          '   O token fica guardado mesmo se você recarregar a página.',
          '3. **`POST /orders`** — escolha um dos exemplos no seletor do corpo. Responde **201 PENDING**.',
          '4. **`GET /orders/{id}`** alguns segundos depois: o worker já levou a **PROCESSED**.',
          '5. Repita o `POST` com o exemplo *estoque insuficiente*: vira **FAILED** com',
          '   `"estoque insuficiente"` — e o estoque continua intacto.',
          '6. Para reprocessar um `FAILED`, autentique-se de novo como **admin@loja.test** / `admin123`',
          '   (a rota exige papel `ADMIN`) e chame **`POST /orders/{id}/reprocess`**.',
          '',
          '### Coisas que valem saber antes de clicar',
          '',
          '- O catálogo nasce com **5 unidades** de cada produto. Produtos disponíveis:',
          '  `Teclado Mecanico`, `Mouse Sem Fio`, `Monitor 27 polegadas`, `Headset Gamer`, `Webcam Full HD`.',
          '- **Cinco unidades acabam rápido explorando.** Quando todo pedido começar a voltar',
          '  `FAILED: estoque insuficiente`, o sistema está certo e o estoque é que zerou.',
          '  Repor sem perder os pedidos já criados: `npm run db:reset-stock`.',
          '  Voltar ao estado de fábrica, apagando tudo: `npm run db:reset`.',
          '- Dinheiro trafega como **string decimal** (`"249.90"`), nunca como número — `29.99` em',
          '  JSON é um double, e aritmética sobre ele perde centavo.',
          '- Toda resposta traz o header **`x-correlation-id`**. É o id que aparece nos logs da API,',
          '  do relay e do worker: `docker compose logs | grep "<id>"` reconstrói a linha do tempo.',
          '- O exemplo *gatilho de falha* (`"fail"` no nome) leva ~65 s: são 4 tentativas com esperas',
          '  de 5s, 15s e 45s antes da dead-letter. As filas ficam visíveis em http://localhost:15672.',
        ].join('\n'),
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Cole apenas o accessToken — sem o prefixo "Bearer".',
        },
        'bearer',
      )
      .addTag('auth', 'Comece por aqui: troque credenciais por um JWT')
      .addTag('orders', 'Criação, consulta e reprocessamento de pedidos')
      .addTag('health', 'Liveness e readiness — públicas, não exigem token')
      .build(),
  );

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Async Order Processor — API',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      tagsSorter: 'alpha',
    },
  });
}
