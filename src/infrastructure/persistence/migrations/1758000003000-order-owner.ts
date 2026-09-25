import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderOwner1758000003000 implements MigrationInterface {
  name = 'OrderOwner1758000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE orders
        ADD COLUMN created_by VARCHAR(160) NOT NULL DEFAULT '' AFTER customer_name,
        ADD KEY ix_orders_created_by (created_by, created_at, id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE orders
        DROP KEY ix_orders_created_by,
        DROP COLUMN created_by
    `);
  }
}
