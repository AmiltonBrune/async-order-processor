import { UserRole } from './user-role.enum';

export class User {
  constructor(
    readonly id: string,
    readonly email: string,
    readonly passwordHash: string,
    readonly role: UserRole,
  ) {}

  isAdmin(): boolean {
    return this.role === UserRole.ADMIN;
  }
}
