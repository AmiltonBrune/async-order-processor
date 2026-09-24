import { EntitySchema } from 'typeorm';

import { UserRole } from '../../../domain/user/user-role.enum';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

export const UserEntity = new EntitySchema<UserRow>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    email: { type: 'varchar', length: 160 },
    passwordHash: { type: 'varchar', length: 255, name: 'password_hash' },
    role: { type: 'enum', enum: UserRole },
  },
  uniques: [{ name: 'uq_users_email', columns: ['email'] }],
});
