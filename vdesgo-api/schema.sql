CREATE TABLE IF NOT EXISTS factory_summary (
  id SERIAL PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  value VARCHAR(80) NOT NULL,
  detail VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factory_products (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(120) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  vat VARCHAR(20) NOT NULL,
  e_point VARCHAR(20) NOT NULL,
  volume VARCHAR(50) NOT NULL,
  weight VARCHAR(50) NOT NULL,
  product_type VARCHAR(120) NOT NULL DEFAULT '',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factory_warehouses (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(80) NOT NULL,
  area VARCHAR(50) NOT NULL DEFAULT '',
  tenant_code VARCHAR(50),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS distributor_customers (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  territory VARCHAR(120) NOT NULL,
  sales_representative VARCHAR(120) NOT NULL,
  warehouse VARCHAR(150) NOT NULL,
  balance VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  level VARCHAR(40) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  permissions TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS distributor_users (
  id SERIAL PRIMARY KEY,
  customer_code VARCHAR(50),
  distributor_name VARCHAR(150) NOT NULL,
  username VARCHAR(80) UNIQUE NOT NULL,
  password VARCHAR(200) NOT NULL,
  password_hash VARCHAR(255),
  role_name VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Aktif',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factory_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_name VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Aktif',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_cards (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  title VARCHAR(150) NOT NULL DEFAULT '',
  province VARCHAR(80) NOT NULL DEFAULT '',
  district VARCHAR(80) NOT NULL DEFAULT '',
  type VARCHAR(80) NOT NULL DEFAULT '',
  territory VARCHAR(120) NOT NULL DEFAULT '',
  sales_representative VARCHAR(120) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  mobile_phone VARCHAR(40) NOT NULL DEFAULT '',
  tax_no VARCHAR(40) NOT NULL DEFAULT '',
  tax_office VARCHAR(120) NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  location VARCHAR(255) NOT NULL DEFAULT '',
  area_m2 NUMERIC(12, 2),

  balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  customer_group_code VARCHAR(50),
  customer_discount_1 VARCHAR(20) NOT NULL DEFAULT '',
  customer_discount_2 VARCHAR(20) NOT NULL DEFAULT '',
  customer_discount_3 VARCHAR(20) NOT NULL DEFAULT '',
  cash_discount VARCHAR(20) NOT NULL DEFAULT '',
  deferred_discount VARCHAR(20) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  tenant_code VARCHAR(50)
);

ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS customer_group_code VARCHAR(50);
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS customer_discount_1 VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS customer_discount_2 VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS customer_discount_3 VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS cash_discount VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS deferred_discount VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS province VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS district VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS location VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS area_m2 NUMERIC(12, 2);

ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS tenant_code VARCHAR(50);

CREATE TABLE IF NOT EXISTS sales_invoices (
  id SERIAL PRIMARY KEY, invoice_no VARCHAR(50) UNIQUE, invoice_date DATE NOT NULL,
  customer_code VARCHAR(50) NOT NULL, customer_name VARCHAR(150) NOT NULL DEFAULT '',
  sales_representative VARCHAR(150) NOT NULL DEFAULT '', sale_type VARCHAR(30), warehouse_code VARCHAR(50) NOT NULL,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0, created_by VARCHAR(80), created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  product_code VARCHAR(50) NOT NULL, product_name VARCHAR(150) NOT NULL, unit VARCHAR(50) NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL, inner_quantity NUMERIC(14, 3) NOT NULL DEFAULT 1,
  total_quantity NUMERIC(14, 3) NOT NULL, unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14, 2) NOT NULL DEFAULT 0, is_promotional BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id SERIAL PRIMARY KEY, invoice_no VARCHAR(50) UNIQUE, invoice_date DATE NOT NULL,
  customer_code VARCHAR(50) NOT NULL REFERENCES customer_cards(code), customer_name VARCHAR(150) NOT NULL DEFAULT '',
  warehouse_code VARCHAR(50) NOT NULL, total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0, stock_entry_id INTEGER,
  created_by VARCHAR(80), created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_code VARCHAR(50) NOT NULL, product_name VARCHAR(150) NOT NULL, unit VARCHAR(50) NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL, inner_quantity NUMERIC(14, 3) NOT NULL DEFAULT 1,
  total_quantity NUMERIC(14, 3) NOT NULL, unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14, 2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS return_invoices (
  id SERIAL PRIMARY KEY, invoice_no VARCHAR(50) UNIQUE, invoice_date DATE NOT NULL,
  customer_code VARCHAR(50) NOT NULL REFERENCES customer_cards(code), customer_name VARCHAR(150) NOT NULL DEFAULT '',
  warehouse_code VARCHAR(50) NOT NULL, total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0, stock_entry_id INTEGER, return_type VARCHAR(20) NOT NULL DEFAULT 'Sağlam',
  created_by VARCHAR(80), created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS stock_entry_id INTEGER;
ALTER TABLE return_invoices ADD COLUMN IF NOT EXISTS stock_entry_id INTEGER;
ALTER TABLE return_invoices ADD COLUMN IF NOT EXISTS return_type VARCHAR(20) NOT NULL DEFAULT 'Sağlam';
CREATE TABLE IF NOT EXISTS return_invoice_lines (
  id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES return_invoices(id) ON DELETE CASCADE,
  product_code VARCHAR(50) NOT NULL, product_name VARCHAR(150) NOT NULL, unit VARCHAR(50) NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL, inner_quantity NUMERIC(14, 3) NOT NULL DEFAULT 1,
  total_quantity NUMERIC(14, 3) NOT NULL, unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14, 2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, order_no VARCHAR(50) UNIQUE, order_date DATE NOT NULL,
  customer_code VARCHAR(50) NOT NULL REFERENCES customer_cards(code), warehouse_code VARCHAR(50) NOT NULL,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0, stock_reserved BOOLEAN NOT NULL DEFAULT FALSE,
  reservation_exit_id INTEGER,
  tenant_code VARCHAR(50), created_by VARCHAR(80), created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_exit_id INTEGER;
CREATE TABLE IF NOT EXISTS order_lines (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_code VARCHAR(50) NOT NULL, product_name VARCHAR(150) NOT NULL, unit VARCHAR(50) NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL, inner_quantity NUMERIC(14, 3) NOT NULL DEFAULT 1,
  total_quantity NUMERIC(14, 3) NOT NULL, unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14, 2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS customer_collection_operations (
  id SERIAL PRIMARY KEY, customer_code VARCHAR(50) NOT NULL REFERENCES customer_cards(code),
  operation_type VARCHAR(30) NOT NULL, amount NUMERIC(14, 2) NOT NULL,
  description TEXT NOT NULL DEFAULT '', operation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  balance_delta INTEGER NOT NULL, created_by VARCHAR(80), created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_collection_customer ON customer_collection_operations(customer_code);
CREATE INDEX IF NOT EXISTS idx_collection_date ON customer_collection_operations(operation_date DESC);

CREATE TABLE IF NOT EXISTS customer_types (code VARCHAR(50) PRIMARY KEY, name VARCHAR(120) NOT NULL);
CREATE TABLE IF NOT EXISTS customer_groups (code VARCHAR(50) PRIMARY KEY, name VARCHAR(120) NOT NULL);
CREATE TABLE IF NOT EXISTS sales_chiefs (code VARCHAR(50) PRIMARY KEY, name VARCHAR(120) NOT NULL);
CREATE TABLE IF NOT EXISTS customer_regions (code VARCHAR(50) PRIMARY KEY, name VARCHAR(120) NOT NULL, manager VARCHAR(120) NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS product_groups (code VARCHAR(50) PRIMARY KEY, name VARCHAR(120) NOT NULL);
CREATE TABLE IF NOT EXISTS product_types (code VARCHAR(50) PRIMARY KEY, name VARCHAR(120) NOT NULL);
CREATE TABLE IF NOT EXISTS product_units (id SERIAL PRIMARY KEY, product_code VARCHAR(50) NOT NULL, unit VARCHAR(50) NOT NULL, inner_quantity VARCHAR(50) NOT NULL, barcode VARCHAR(80) UNIQUE NOT NULL);

CREATE TABLE IF NOT EXISTS central_promotions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  promotion_type VARCHAR(40) NOT NULL,
  condition_type VARCHAR(40) NOT NULL,
  condition_unit VARCHAR(50) NOT NULL DEFAULT 'Adet',
  threshold NUMERIC(12, 2) NOT NULL DEFAULT 1,
  reward_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reward_type VARCHAR(30) NOT NULL DEFAULT 'discount',
  reward_product_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  reward_product_units JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  customer_type_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  customer_group_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  customer_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  product_type_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  product_group_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  product_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS other_stock_entries (
  id SERIAL PRIMARY KEY,
  receipt_no INTEGER NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entering_warehouse_code VARCHAR(50) NOT NULL,
  exiting_warehouse_code VARCHAR(50),
  tenant_code VARCHAR(50),
  created_by VARCHAR(80),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (receipt_no, tenant_code)
);

CREATE TABLE IF NOT EXISTS other_stock_entry_lines (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES other_stock_entries(id) ON DELETE CASCADE,
  product_code VARCHAR(50) NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  inner_quantity VARCHAR(50) NOT NULL DEFAULT '',
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  total_quantity NUMERIC(12, 2) NOT NULL CHECK (total_quantity > 0)
);

CREATE TABLE IF NOT EXISTS other_stock_exits (
  id SERIAL PRIMARY KEY,
  receipt_no INTEGER NOT NULL,
  exit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  exiting_warehouse_code VARCHAR(50) NOT NULL,
  tenant_code VARCHAR(50),
  created_by VARCHAR(80),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (receipt_no, tenant_code)
);

CREATE TABLE IF NOT EXISTS other_stock_exit_lines (
  id SERIAL PRIMARY KEY,
  exit_id INTEGER NOT NULL REFERENCES other_stock_exits(id) ON DELETE CASCADE,
  product_code VARCHAR(50) NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  inner_quantity VARCHAR(50) NOT NULL DEFAULT '',
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  total_quantity NUMERIC(12, 2) NOT NULL CHECK (total_quantity > 0)
);

CREATE TABLE IF NOT EXISTS warehouse_transfers (
  id SERIAL PRIMARY KEY,
  receipt_no INTEGER NOT NULL,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entering_warehouse_code VARCHAR(50) NOT NULL,
  exiting_warehouse_code VARCHAR(50) NOT NULL,
  tenant_code VARCHAR(50),
  created_by VARCHAR(80),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (receipt_no, tenant_code)
);

CREATE TABLE IF NOT EXISTS warehouse_transfer_lines (
  id SERIAL PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES warehouse_transfers(id) ON DELETE CASCADE,
  product_code VARCHAR(50) NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  inner_quantity VARCHAR(50) NOT NULL DEFAULT '',
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  total_quantity NUMERIC(12, 2) NOT NULL CHECK (total_quantity > 0)
);

CREATE TABLE IF NOT EXISTS vehicle_loadings (
  id SERIAL PRIMARY KEY,
  receipt_no INTEGER NOT NULL,
  loading_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entering_warehouse_code VARCHAR(50) NOT NULL,
  exiting_warehouse_code VARCHAR(50) NOT NULL,
  tenant_code VARCHAR(50),
  created_by VARCHAR(80),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (receipt_no, tenant_code)
);

CREATE TABLE IF NOT EXISTS vehicle_loading_lines (
  id SERIAL PRIMARY KEY,
  loading_id INTEGER NOT NULL REFERENCES vehicle_loadings(id) ON DELETE CASCADE,
  product_code VARCHAR(50) NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  inner_quantity VARCHAR(50) NOT NULL DEFAULT '',
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  total_quantity NUMERIC(12, 2) NOT NULL CHECK (total_quantity > 0)
);

CREATE TABLE IF NOT EXISTS product_prices (
  id SERIAL PRIMARY KEY,
  product_code VARCHAR(50) NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  purchase_price VARCHAR(50) NOT NULL DEFAULT '',
  sales_price VARCHAR(50) NOT NULL DEFAULT '',
  sound_return_price VARCHAR(50) NOT NULL DEFAULT '',
  damaged_return_price VARCHAR(50) NOT NULL DEFAULT '',
  recommended_sales_price VARCHAR(50) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'Aktif'
);
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS product_code VARCHAR(50);
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS product_name VARCHAR(150);
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS purchase_price VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS sales_price VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS sound_return_price VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS damaged_return_price VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS recommended_sales_price VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE product_prices ALTER COLUMN product_code DROP NOT NULL;
ALTER TABLE product_prices ALTER COLUMN product_name DROP NOT NULL;
ALTER TABLE product_prices ALTER COLUMN start_date DROP NOT NULL;
CREATE TABLE IF NOT EXISTS security_access_matrix (username VARCHAR(80) PRIMARY KEY, permissions JSONB NOT NULL DEFAULT '{}'::jsonb);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(120),
  action VARCHAR(30) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_by VARCHAR(80),
  ip_address INET,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at ON audit_logs(changed_at DESC);

ALTER TABLE factory_warehouses ADD COLUMN IF NOT EXISTS area VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE factory_warehouses ADD COLUMN IF NOT EXISTS tenant_code VARCHAR(50);
ALTER TABLE factory_products ADD COLUMN IF NOT EXISTS product_type VARCHAR(120) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS shipment_vehicles (
  id SERIAL PRIMARY KEY,
  plate VARCHAR(20) UNIQUE NOT NULL,
  license_number VARCHAR(80) NOT NULL,
  vehicle_type VARCHAR(80) NOT NULL DEFAULT 'Kamyonet',
  brand_model VARCHAR(150) NOT NULL DEFAULT '',
  model_year VARCHAR(10) NOT NULL DEFAULT '',
  capacity VARCHAR(50) NOT NULL DEFAULT '',
  insurance_start_date DATE NOT NULL,
  insurance_end_date DATE NOT NULL,
  casco_start_date DATE NOT NULL,
  casco_end_date DATE NOT NULL,
  last_oil_maintenance_km VARCHAR(30) NOT NULL DEFAULT '',
  last_oil_maintenance_date DATE,
  tire_change_date DATE,
  tire_change_km VARCHAR(30) NOT NULL DEFAULT '',
  inspection_due_date DATE,
  driver_name VARCHAR(120) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  tenant_code VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_representatives (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  route_region VARCHAR(120) NOT NULL DEFAULT '',
  vehicle_warehouse_code VARCHAR(50),
  order_warehouse_code VARCHAR(50),
  sales_type VARCHAR(30) NOT NULL DEFAULT 'Sıcak Satış',
  note TEXT NOT NULL DEFAULT '',
  vehicle_plate VARCHAR(20),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  tenant_code VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_code, name)
);

CREATE TABLE IF NOT EXISTS sales_rep_customers (
  id SERIAL PRIMARY KEY,
  tenant_code VARCHAR(50),
  sales_representative_id INTEGER NOT NULL REFERENCES sales_representatives(id) ON DELETE CASCADE,
  customer_code VARCHAR(50) NOT NULL REFERENCES customer_cards(code) ON DELETE CASCADE,
  route_day VARCHAR(20) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_code, sales_representative_id, customer_code, route_day)
);

