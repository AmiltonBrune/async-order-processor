import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1758000000000 implements MigrationInterface {
  name = 'InitialSchema1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE products (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name        VARCHAR(128)    NOT NULL,
        price       DECIMAL(12,2)   NOT NULL,
        stock       INT UNSIGNED    NOT NULL DEFAULT 0,
        created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_products_name (name),
        CONSTRAINT ck_products_stock_non_negative CHECK (stock >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE orders (
        id                  CHAR(36)      NOT NULL,
        customer_name       VARCHAR(160)  NOT NULL,
        status              ENUM('PENDING','PROCESSED','FAILED') NOT NULL DEFAULT 'PENDING',
        total_amount        DECIMAL(12,2) NOT NULL,
        currency            CHAR(3)       NOT NULL DEFAULT 'BRL',
        failure_code        VARCHAR(40)   NULL,
        failure_reason      VARCHAR(255)  NULL,
        processing_attempts INT UNSIGNED  NOT NULL DEFAULT 0,
        correlation_id      CHAR(36)      NOT NULL,
        processed_at        DATETIME(3)   NULL,
        created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_orders_created_at (created_at, id),
        KEY ix_orders_status_created_at (status, created_at, id),
        KEY ix_orders_correlation_id (correlation_id),
        CONSTRAINT ck_orders_failure_pair CHECK (
          (status = 'FAILED' AND failure_code IS NOT NULL)
          OR (status <> 'FAILED' AND failure_code IS NULL)
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE order_items (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id     CHAR(36)        NOT NULL,
        product_id   BIGINT UNSIGNED NOT NULL,
        product_name VARCHAR(128)    NOT NULL,
        unit_price   DECIMAL(12,2)   NOT NULL,
        quantity     INT UNSIGNED    NOT NULL,
        line_total   DECIMAL(12,2) AS (unit_price * quantity) STORED,
        PRIMARY KEY (id),
        UNIQUE KEY uq_order_items_order_product (order_id, product_id),
        KEY ix_order_items_product (product_id),
        CONSTRAINT fk_order_items_order   FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
        CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
        CONSTRAINT ck_order_items_quantity_positive CHECK (quantity > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE stock_reservations (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id    CHAR(36)        NOT NULL,
        product_id  BIGINT UNSIGNED NOT NULL,
        quantity    INT UNSIGNED    NOT NULL,
        reserved_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_stock_reservations_order_product (order_id, product_id),
        CONSTRAINT fk_stock_res_order   FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
        CONSTRAINT fk_stock_res_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE outbox_messages (
        id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id       CHAR(36)        NOT NULL,
        aggregate_type VARCHAR(32)     NOT NULL,
        aggregate_id   CHAR(36)        NOT NULL,
        event_name     VARCHAR(64)     NOT NULL,
        payload        JSON            NOT NULL,
        status         ENUM('PENDING','PUBLISHED','FAILED') NOT NULL DEFAULT 'PENDING',
        attempts       INT UNSIGNED    NOT NULL DEFAULT 0,
        last_error     VARCHAR(255)    NULL,
        available_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        published_at   DATETIME(3)     NULL,
        created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_outbox_event_id (event_id),
        KEY ix_outbox_dispatch (status, available_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE inbox_messages (
        consumer     VARCHAR(64) NOT NULL,
        event_id     CHAR(36)    NOT NULL,
        order_id     CHAR(36)    NOT NULL,
        processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (consumer, event_id),
        KEY ix_inbox_order (order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE users (
        id            CHAR(36)     NOT NULL,
        email         VARCHAR(160) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role          ENUM('ADMIN','CUSTOMER') NOT NULL DEFAULT 'CUSTOMER',
        created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'inbox_messages',
      'outbox_messages',
      'stock_reservations',
      'order_items',
      'orders',
      'users',
      'products',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
