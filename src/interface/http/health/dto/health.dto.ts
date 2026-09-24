import { ApiProperty } from '@nestjs/swagger';

import { HealthDependencyDto } from './health-dependency.dto';

export class HealthDto {
  @ApiProperty({ example: 'ok', enum: ['ok', 'degraded'] })
  status!: string;

  @ApiProperty({ type: [HealthDependencyDto], required: false })
  dependencies?: HealthDependencyDto[];
}
