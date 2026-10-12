-- The shop's subcollections — Tops, Bottoms, Jackets… — in the owner's order,
-- named in the admin. A piece's product type is the one it is in. Empty means
-- the built-in list.
ALTER TABLE store_settings ADD COLUMN categories_json text NOT NULL DEFAULT '[]';
