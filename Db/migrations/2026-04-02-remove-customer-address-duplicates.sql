-- Remove duplicate customer address fields; use location + address only.
-- Map city -> location and address_line1/address_line2 -> address where missing.
UPDATE customers
SET location = COALESCE(NULLIF(location, ''), NULLIF(city, '')),
    address = COALESCE(
      NULLIF(address, ''),
      NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ', NULLIF(address_line1, ''), NULLIF(address_line2, ''))), '')
    )
WHERE (location IS NULL OR location = '')
   OR (address IS NULL OR address = '');

ALTER TABLE customers
  DROP COLUMN IF EXISTS address_line1,
  DROP COLUMN IF EXISTS address_line2,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS pincode;
