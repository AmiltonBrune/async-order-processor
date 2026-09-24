import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { PasswordHasher } from '../../../domain/ports/system/password-hasher.port';

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  private static readonly KEY_LENGTH = 32;
  private static readonly SALT_LENGTH = 16;
  private static readonly PREFIX = 'scrypt';

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(ScryptPasswordHasher.SALT_LENGTH);
    const derived = await derive(plain, salt, ScryptPasswordHasher.KEY_LENGTH);
    return [ScryptPasswordHasher.PREFIX, salt.toString('hex'), derived.toString('hex')].join('$');
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    const [prefix, saltHex, expectedHex] = hash.split('$');
    if (prefix !== ScryptPasswordHasher.PREFIX || saltHex === undefined || expectedHex === undefined) {
      await derive(plain, randomBytes(ScryptPasswordHasher.SALT_LENGTH), ScryptPasswordHasher.KEY_LENGTH);
      return false;
    }
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = await derive(plain, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  static async hashWithSalt(plain: string, saltHex: string): Promise<string> {
    const salt = Buffer.from(saltHex, 'hex');
    const derived = await derive(plain, salt, ScryptPasswordHasher.KEY_LENGTH);
    return [ScryptPasswordHasher.PREFIX, saltHex, derived.toString('hex')].join('$');
  }
}
