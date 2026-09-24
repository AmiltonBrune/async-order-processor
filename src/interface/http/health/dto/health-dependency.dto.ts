import { ApiProperty } from '@nestjs/swagger';

export class HealthDependencyDto {
  @ApiProperty({ example: 'mysql' })
  name!: string;

  @ApiProperty({ example: true })
  up!: boolean;
}
