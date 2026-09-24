import { MigrationInterface, QueryRunner } from 'typeorm';

import { ScryptPasswordHasher } from '../../security/hashing/scrypt.hasher';

export class SeedUsers1758000002000 implements MigrationInterface {
  name = 'SeedUsers1758000002000';

  private static readonly USERS: ReadonlyArray<[string, string, string, string, string]> = [
    ['0193a000-0000-7000-8000-000000000001', 'admin@loja.test', 'admin123', 'ADMIN', '00112233445566778899aabbccddeeff'],
    ['0193a000-0000-7000-8000-000000000002', 'cliente@loja.test', 'cliente123', 'CUSTOMER', 'ffeeddccbbaa99887766554433221100'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [id, email, password, role, salt] of SeedUsers1758000002000.USERS) {
      const hash = await ScryptPasswordHasher.hashWithSalt(password, salt);
      await queryRunner.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
        [id, email, hash, role],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM users WHERE email IN (?, ?)`,
      SeedUsers1758000002000.USERS.map(([, email]) => email));
  }
}
