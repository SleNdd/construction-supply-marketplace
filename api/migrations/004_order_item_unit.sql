ALTER TABLE order_items ADD COLUMN unit text;

UPDATE order_items i SET unit=p.unit
FROM offers o JOIN products p ON p.id=o.product_id
WHERE o.id=i.offer_id;

ALTER TABLE order_items ALTER COLUMN unit SET NOT NULL;
