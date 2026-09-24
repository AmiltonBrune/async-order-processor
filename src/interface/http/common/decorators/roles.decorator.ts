import { SetMetadata } from '@nestjs/common';

import { UserRole } from '../../../../domain/user/user-role.enum';
import { REQUIRED_ROLES } from '../../http.constants';

export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);
