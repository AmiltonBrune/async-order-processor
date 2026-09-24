import { User } from '../../user/user.entity';

export const USER_REPOSITORY = Symbol('UserRepository');

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
}
