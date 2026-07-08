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
DROP POLICY IF EXISTS anon_all ON rooms;
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
DROP FUNCTION IF EXISTS delete_old_rooms(INT);
CREATE FUNCTION delete_old_rooms(days INT)
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

-- 6. Atomarer Spieler-Entferner (für leave + sendBeacon bei Tab-Schließen)
DROP FUNCTION IF EXISTS remove_player(TEXT, TEXT);
CREATE FUNCTION remove_player(room_code TEXT, player_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur JSONB;
  upd JSONB;
  cnt INT;
BEGIN
  SELECT state INTO cur FROM rooms WHERE code = room_code;
  IF cur IS NULL THEN RETURN; END IF;

  upd := jsonb_set(cur, '{players}', COALESCE(
    (SELECT jsonb_agg(p) FROM jsonb_array_elements(cur->'players') p WHERE p->>'id' != player_id),
    '[]'::jsonb
  ));

  cnt := jsonb_array_length(upd->'players');
  IF cnt = 0 THEN
    DELETE FROM rooms WHERE code = room_code;
  ELSE
    UPDATE rooms SET state = upd WHERE code = room_code;
  END IF;
END;
$$;

-- 7. ☝️ Don't forget: Enable Realtime for the "rooms" table
--    Go to Dashboard → Realtime → toggle "rooms" table ON
