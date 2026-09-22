-- A piece is an accessory because it is marked one, not because of which
-- collection it happens to sit in. The section that shows them asks the
-- flag, so a collection can be renamed, emptied or deleted without the
-- jewellery quietly disappearing from the shop.
ALTER TABLE products ADD COLUMN is_accessory INTEGER NOT NULL DEFAULT 0;

-- What the house already sells: its jewellery, recognised by the type the
-- catalogue was imported with. Safe to re-run; it only ever sets the flag on.
UPDATE products
SET is_accessory = 1
WHERE lower(product_type) IN ('necklaces', 'necklace', 'earrings', 'earring', 'bracelets', 'bracelet', 'jewellery', 'jewelry');

CREATE INDEX IF NOT EXISTS products_accessory ON products (is_accessory);
