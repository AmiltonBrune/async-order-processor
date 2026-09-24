import { ApiProperty } from '@nestjs/swagger';

import { PageMetaDto } from '../../common/dto/page-meta.dto';
import { OrderResponseDto } from './order-response.dto';

export class PaginatedOrdersDto {
  @ApiProperty({ type: [OrderResponseDto] })
  data!: OrderResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
