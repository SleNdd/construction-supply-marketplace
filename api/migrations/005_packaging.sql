ALTER TABLE products ADD COLUMN packaging jsonb;

-- Заполняем только проверенные демопозиции с неизменёнными исходными параметрами.
UPDATE products p SET packaging=v.packaging
FROM (VALUES
  ('cement','Цемент М500 50 кг','мешок','{"Вес":"50 кг","Марка":"М500"}'::jsonb,'{"kind":"dry-mix","packSizeKg":50}'::jsonb),
  ('plaster','Штукатурка гипсовая 30 кг','мешок','{"Вес":"30 кг","Расход":"0,85 кг/м²·мм"}'::jsonb,'{"kind":"dry-mix","packSizeKg":30}'::jsonb),
  ('adhesive','Клей плиточный 25 кг','мешок','{"Вес":"25 кг","Класс":"C1"}'::jsonb,'{"kind":"dry-mix","packSizeKg":25}'::jsonb),
  ('paint-white','Краска интерьерная белая 10 л','ведро','{"Объём":"10 л","Расход":"0,11 л/м²"}'::jsonb,'{"kind":"paint","packSizeL":10}'::jsonb),
  ('paint-facade','Краска фасадная 9 л','ведро','{"Объём":"9 л","Расход":"0,15 л/м²"}'::jsonb,'{"kind":"paint","packSizeL":9}'::jsonb)
) v(key,name,unit,specs,packaging)
WHERE p.id=md5('objectmarket-demo-'||v.key)::uuid AND p.slug=v.key AND p.name=v.name AND p.unit=v.unit AND p.specs=v.specs AND p.packaging IS NULL;

-- Новые единицы продажи получают отдельные ID; прежние м² и снимки сохраняются.
INSERT INTO products(id,category_id,slug,name,unit,image_url,description,specs,packaging)
SELECT md5('objectmarket-demo-'||v.key||'-box')::uuid,p.category_id,v.key||'-box',p.name||' — коробка','коробка',p.image_url,p.description,p.specs,v.packaging
FROM products p JOIN (VALUES
  ('tile-beige','Керамогранит Песчаник 60×60','{"Формат":"60×60 см","Площадь коробки":"1,44 м²"}'::jsonb,'{"kind":"tiles","tileAreaM2":0.36,"tilesPerPack":4}'::jsonb),
  ('tile-grey','Плитка настенная Графит 30×60','{"Формат":"30×60 см","Площадь коробки":"1,26 м²"}'::jsonb,'{"kind":"tiles","tileAreaM2":0.18,"tilesPerPack":7}'::jsonb)
) v(key,name,specs,packaging) ON p.id=md5('objectmarket-demo-'||v.key)::uuid AND p.slug=v.key AND p.name=v.name AND p.unit='м²' AND p.specs=v.specs
ON CONFLICT DO NOTHING;

-- Явные вымышленные цены за коробку; старый запас не копируется и не конвертируется.
INSERT INTO offers(id,product_id,supplier_id,warehouse_id,price_kopecks,stock,delivery_days,delivery_cost_kopecks)
SELECT md5('objectmarket-demo-offer-'||v.key||'-box-'||s.key)::uuid,p.id,o.supplier_id,o.warehouse_id,
  CASE WHEN s.key='volga' THEN v.volga_price ELSE v.kaspiy_price END,0,o.delivery_days,o.delivery_cost_kopecks
FROM (VALUES ('tile-beige',185760,191664),('tile-grey',183708,188874)) v(key,volga_price,kaspiy_price)
CROSS JOIN (VALUES ('volga'),('kaspiy')) s(key)
JOIN products p ON p.id=md5('objectmarket-demo-'||v.key||'-box')::uuid AND p.unit='коробка' AND p.packaging->>'kind'='tiles'
JOIN offers o ON o.id=md5('objectmarket-demo-offer-'||v.key||'-'||s.key)::uuid
  AND o.product_id=md5('objectmarket-demo-'||v.key)::uuid AND o.supplier_id=md5('objectmarket-demo-'||s.key)::uuid
ON CONFLICT DO NOTHING;

CREATE TABLE project_calculation_keys (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash text NOT NULL,
  -- Без FK позиции: после её удаления ключ сохраняется до удаления объекта.
  item_id uuid NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY(project_id,key)
);
