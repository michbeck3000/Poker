-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)

-- 1. Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- 3. Allow anonymous access (anon key)
CREATE POLICY anon_all ON rooms
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- 4. Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rooms_updated_at ON rooms;
CREATE TRIGGER rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 5. Stored procedure to delete rooms older than N days
CREATE OR REPLACE FUNCTION delete_old_rooms(days INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM rooms
  WHERE created_at < now() - (days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- 6. ☝️ Don't forget: Enable Realtime for the "rooms" table
--    Go to Dashboard → Realtime → toggle "rooms" table ON
