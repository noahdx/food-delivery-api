import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE orders (
      id BIGSERIAL PRIMARY KEY,
      public_id UUID NOT NULL UNIQUE,
      restaurant_id BIGINT NOT NULL REFERENCES restaurants(id),
      branch_id BIGINT NOT NULL REFERENCES restaurant_branches(id),
      customer_id BIGINT NOT NULL REFERENCES users(id),
      customer_address_id BIGINT NOT NULL REFERENCES customer_addresses(id),
      delivery_lat DECIMAL(10, 7) NOT NULL,
      delivery_lng DECIMAL(10, 7) NOT NULL,
      delivery_address_text_snapshot TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'pending_payment',
          'placed',
          'accepted',
          'rejected',
          'preparing',
          'ready',
          'assigned',
          'picked',
          'delivered',
          'cancelled'
        )
      ),
      subtotal INT NOT NULL,
      delivery_fee INT NOT NULL,
      service_fee INT NOT NULL,
      total INT NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('online', 'cod')),
      agent_id BIGINT REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      accepted_at TIMESTAMP NULL,
      rejected_at TIMESTAMP NULL,
      ready_at TIMESTAMP NULL,
      assigned_at TIMESTAMP NULL,
      picked_at TIMESTAMP NULL,
      delivered_at TIMESTAMP NULL,
      cancelled_at TIMESTAMP NULL
    );

    CREATE INDEX idx_orders_public_id ON orders (public_id);
    CREATE INDEX idx_orders_customer_id_created_at ON orders (customer_id, created_at DESC);
    CREATE INDEX idx_orders_branch_status_created_at ON orders (branch_id, status, created_at DESC);
    CREATE INDEX idx_orders_restaurant_id_created_at ON orders (restaurant_id, created_at DESC);
    CREATE INDEX idx_orders_status_created_at ON orders (status, created_at) WHERE status IN ('ready', 'assigned');
    CREATE INDEX idx_orders_agent_id_status ON orders (agent_id, status) WHERE agent_id IS NOT NULL;

    CREATE TABLE order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id),
      product_branch_detail_id BIGINT NOT NULL REFERENCES product_branch_details(id),
      quantity INT NOT NULL CHECK (quantity > 0),
      unit_price_snapshot INT NOT NULL,
      name_snapshot TEXT NOT NULL,
      image_url_snapshot TEXT NULL,
      line_total INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_order_items_order_id ON order_items (order_id);
    CREATE INDEX idx_order_items_product_id ON order_items (product_id);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders;
  `);
}
