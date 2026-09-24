import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { READINESS_PROBES, ReadinessProbe } from '../../../domain/ports/system/readiness-probe.port';
import { HealthDto } from './dto/health.dto';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS_PROBES) private readonly probes: readonly ReadinessProbe[]) {}

  @Get('live')
  @Public()
  @ApiOperation({
    summary: 'O processo está vivo',
    description: 'Não toca em MySQL nem RabbitMQ de propósito. Público: não exige token.',
  })
  @ApiResponse({ status: 200, description: 'Processo no ar.', type: HealthDto })
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @ApiOperation({
    summary: 'O processo consegue atender (MySQL e RabbitMQ acessíveis)',
    description: 'É o health check que o Docker Compose usa no `--wait`. Público: não exige token.',
  })
  @ApiResponse({ status: 200, description: 'Todas as dependências de pé.', type: HealthDto })
  @ApiResponse({ status: 503, description: 'Alguma dependência fora — não coloque no balanceador.', type: HealthDto })
  async ready(
    @Res() response: { status(code: number): { json(body: unknown): void } },
  ): Promise<void> {
    const results = await Promise.all(
      this.probes.map(async (probe) => ({ name: probe.name, up: await probe.check() })),
    );
    const allUp = results.every((result) => result.up);
    response
      .status(allUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: allUp ? 'ok' : 'degraded', dependencies: results });
  }
}
