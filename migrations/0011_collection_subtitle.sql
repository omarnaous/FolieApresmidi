-- A collection carries a short season line under its name — "Fall Winter 25–26",
-- "Été 26" — shown on the catalogue header and the boutique. Nullable: a
-- collection with none shows just its title, as before.
ALTER TABLE collections ADD COLUMN subtitle text;
