CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('buyer','supplier','dispatcher','driver','admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL UNIQUE REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  name text NOT NULL,
  address text NOT NULL,
  lon numeric(9,6),
  lat numeric(9,6)
);
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL,
  image_url text,
  description text NOT NULL DEFAULT '',
  specs jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  price_kopecks integer NOT NULL CHECK (price_kopecks > 0),
  stock integer NOT NULL CHECK (stock >= 0),
  delivery_days integer NOT NULL CHECK (delivery_days >= 0),
  delivery_cost_kopecks integer NOT NULL CHECK (delivery_cost_kopecks >= 0),
  active boolean NOT NULL DEFAULT true,
  UNIQUE(product_id,warehouse_id)
);
CREATE INDEX IF NOT EXISTS offers_product_idx ON offers(product_id) WHERE active;
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  address text NOT NULL,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  stage_date date
);
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES users(id),
  project_id uuid REFERENCES projects(id),
  address text NOT NULL,
  requested_date date,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','paid','in_progress','delivered')),
  items_total_kopecks bigint NOT NULL,
  delivery_total_kopecks bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders(buyer_id,created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  offer_id uuid NOT NULL REFERENCES offers(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  price_kopecks integer NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  driver_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','picked_up','in_transit','delivered')),
  scheduled_date date,
  route jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_cost_kopecks integer NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  buyer_id uuid NOT NULL REFERENCES users(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id),
  PRIMARY KEY(buyer_id,key)
);
