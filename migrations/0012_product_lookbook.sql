-- Look-book photographs paired with a piece, shown on its product page. Held
-- by their /media path (the seed look book has no media rows), in order.
CREATE TABLE IF NOT EXISTS product_lookbook (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (product_id, url)
);
CREATE INDEX IF NOT EXISTS product_lookbook_position ON product_lookbook (product_id, position);
