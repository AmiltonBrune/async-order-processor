import { SetMetadata } from '@nestjs/common';

import { IS_PUBLIC } from '../../http.constants';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
