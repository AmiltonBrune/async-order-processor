import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedCatalog1758000001000 implements MigrationInterface {
  name = 'SeedCatalog1758000001000';

  private static readonly CATALOG: ReadonlyArray<[string, string]> = [
    ['Teclado Mecanico', '249.90'],
    ['Mouse Sem Fio', '89.90'],
    ['Monitor 27 polegadas', '1499.00'],
    ['Headset Gamer', '319.50'],
    ['Webcam Full HD', '199.99'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, price] of SeedCatalog1758000001000.CATALOG) {
      await queryRunner.query(
        `INSERT INTO products (name, price, stock) VALUES (?, ?, 5)
         ON DUPLICATE KEY UPDATE price = VALUES(price)`,
        [name, price],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM products WHERE name IN (?, ?, ?, ?, ?)`,
      SeedCatalog1758000001000.CATALOG.map(([name]) => name));
  }
}
