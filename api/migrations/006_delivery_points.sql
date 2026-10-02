-- Исторические адреса и схемы не геокодируются: новые поля получают null / [].
ALTER TABLE orders ADD COLUMN destination_lon double precision;
ALTER TABLE orders ADD COLUMN destination_lat double precision;
ALTER TABLE orders ADD CONSTRAINT orders_destination_coordinates_check CHECK (
  (destination_lon IS NULL AND destination_lat IS NULL) OR
  (destination_lon IS NOT NULL AND destination_lat IS NOT NULL AND
   destination_lon BETWEEN -180 AND 180 AND destination_lat BETWEEN -90 AND 90)
);

CREATE FUNCTION valid_delivery_departure_points(points jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE point jsonb; coordinates jsonb;
BEGIN
  IF jsonb_typeof(points) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(points) LOOP
    IF jsonb_typeof(point) IS DISTINCT FROM 'object' OR
       jsonb_typeof(point->'warehouseId') IS DISTINCT FROM 'string' OR
       (point->>'warehouseId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
       jsonb_typeof(point->'name') IS DISTINCT FROM 'string' OR
       jsonb_typeof(point->'address') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    coordinates := point->'coordinates';
    IF coordinates = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(coordinates) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(coordinates) <> 2 OR
       jsonb_typeof(coordinates->0) IS DISTINCT FROM 'number' OR
       jsonb_typeof(coordinates->1) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    IF (coordinates->>0)::numeric NOT BETWEEN -180 AND 180 OR
       (coordinates->>1)::numeric NOT BETWEEN -90 AND 90 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE deliveries ADD COLUMN departure_points jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (valid_delivery_departure_points(departure_points));
