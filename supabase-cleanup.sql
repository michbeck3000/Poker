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

-- 6. Atomarer Spieler-Entferner (für den "Verlassen"-Button)
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
  SELECT state INTO cur FROM rooms WHERE code = room_code FOR UPDATE;
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

-- 7. Spieler atomar hinzufügen oder aktualisieren (kein Duplikat, kein Lost-Update)
DROP FUNCTION IF EXISTS join_room(TEXT, TEXT, TEXT);
CREATE FUNCTION join_room(room_code TEXT, player_id TEXT, player_name TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur JSONB;
  exists_b BOOLEAN;
BEGIN
  SELECT state INTO cur FROM rooms WHERE code = room_code FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;

  SELECT EXISTS(
    SELECT 1 FROM jsonb_array_elements(cur->'players') p WHERE p->>'id' = player_id
  ) INTO exists_b;

  IF exists_b THEN
    cur := jsonb_set(cur, '{players}', (
      SELECT jsonb_agg(
        CASE WHEN p->>'id' = player_id THEN
          jsonb_build_object('id', player_id, 'name', player_name, 'hasVoted', false,
                             'lastSeen', extract(epoch FROM now())::bigint)
        ELSE p END)
      FROM jsonb_array_elements(cur->'players') p
    ));
  ELSE
    cur := jsonb_set(cur, '{players}',
      (cur->'players') || jsonb_build_array(
        jsonb_build_object('id', player_id, 'name', player_name, 'hasVoted', false,
                           'lastSeen', extract(epoch FROM now())::bigint)
      )
    );
  END IF;

  UPDATE rooms SET state = cur WHERE code = room_code;
END;
$$;

-- 8. Heartbeat: lastSeen des Spielers aktualisieren
DROP FUNCTION IF EXISTS touch_player(TEXT, TEXT);
CREATE FUNCTION touch_player(room_code TEXT, player_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur JSONB;
BEGIN
  SELECT state INTO cur FROM rooms WHERE code = room_code FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;

  cur := jsonb_set(cur, '{players}', (
    SELECT jsonb_agg(
      CASE WHEN p->>'id' = player_id THEN
        p || jsonb_build_object('lastSeen', extract(epoch FROM now())::bigint)
      ELSE p END)
    FROM jsonb_array_elements(cur->'players') p
  ));

  UPDATE rooms SET state = cur WHERE code = room_code;
END;
$$;

-- 9. Abwesende Spieler entfernen (lastSeen älter als threshold_sec Sekunden)
DROP FUNCTION IF EXISTS reap_disconnected(TEXT, INT);
CREATE FUNCTION reap_disconnected(room_code TEXT, threshold_sec INT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur JSONB;
  orig JSONB;
BEGIN
  SELECT state INTO cur FROM rooms WHERE code = room_code FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;

  orig := cur;
  cur := jsonb_set(cur, '{players}', COALESCE(
    (SELECT jsonb_agg(p)
     FROM jsonb_array_elements(cur->'players') p
     WHERE COALESCE(p->>'lastSeen', '0')::bigint >= extract(epoch FROM now())::bigint - threshold_sec),
    '[]'::jsonb
  ));

  IF cur = orig THEN RETURN; END IF;
  UPDATE rooms SET state = cur WHERE code = room_code;
END;
$$;

-- 10. hasVoted atomar setzen
DROP FUNCTION IF EXISTS set_player_voted(TEXT, TEXT);
CREATE FUNCTION set_player_voted(room_code TEXT, player_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur JSONB;
BEGIN
  SELECT state INTO cur FROM rooms WHERE code = room_code FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;

  cur := jsonb_set(cur, '{players}', (
    SELECT jsonb_agg(
      CASE WHEN p->>'id' = player_id THEN
        p || '{"hasVoted":true}'::jsonb
           || jsonb_build_object('lastSeen', extract(epoch FROM now())::bigint)
      ELSE p END)
    FROM jsonb_array_elements(cur->'players') p
  ));

  UPDATE rooms SET state = cur WHERE code = room_code;
END;
$$;

-- 11. Eigene Karte atomar aufdecken (erhält fremde Werte)
DROP FUNCTION IF EXISTS reveal_card(TEXT, TEXT, TEXT);
CREATE FUNCTION reveal_card(room_code TEXT, player_id TEXT, value TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur JSONB;
  rc JSONB;
BEGIN
  SELECT state INTO cur FROM rooms WHERE code = room_code FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;

  rc := COALESCE(cur->'revealedCards', '{}'::jsonb);
  rc := jsonb_set(rc, ARRAY[player_id], COALESCE(value::jsonb, 'null'::jsonb));
  cur := jsonb_set(cur, '{revealedCards}', rc);
  cur := jsonb_set(cur, '{phase}', '"revealed"');
  UPDATE rooms SET state = cur WHERE code = room_code;
END;
$$;

-- 12. Emoji-Wurf atomar anhängen (alte werfen)
DROP FUNCTION IF EXISTS send_throw(TEXT, JSONB);
CREATE FUNCTION send_throw(room_code TEXT, throw_data JSONB)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur JSONB;
BEGIN
  SELECT state INTO cur FROM rooms WHERE code = room_code FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;

  cur := jsonb_set(cur, '{throws}',
    COALESCE(cur->'throws', '[]'::jsonb) || jsonb_build_array(throw_data));

  cur := jsonb_set(cur, '{throws}', COALESCE((
    SELECT jsonb_agg(t) FROM jsonb_array_elements(cur->'throws') t
    WHERE (t->>'timestamp')::bigint >= (extract(epoch FROM now()) * 1000)::bigint - 5000
  ), '[]'::jsonb));

  UPDATE rooms SET state = cur WHERE code = room_code;
END;
$$;

-- 13. Neue Runde: Phase zurücksetzen, Votes/Cards/Throws leeren (Spieler bleiben)
DROP FUNCTION IF EXISTS new_round(TEXT);
CREATE FUNCTION new_round(room_code TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur JSONB;
BEGIN
  SELECT state INTO cur FROM rooms WHERE code = room_code FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;

  cur := jsonb_set(cur, '{phase}', '"voting"');
  cur := jsonb_set(cur, '{players}', COALESCE((
    SELECT jsonb_agg((p - 'hasVoted') || '{"hasVoted":false}'::jsonb)
    FROM jsonb_array_elements(cur->'players') p
  ), '[]'::jsonb));
  cur := jsonb_set(cur, '{revealedCards}', '{}'::jsonb);
  cur := jsonb_set(cur, '{throws}', '[]'::jsonb);
  UPDATE rooms SET state = cur WHERE code = room_code;
END;
$$;

-- 14. ☝️ Don't forget: Enable Realtime for the "rooms" table
--    Go to Dashboard → Realtime → toggle "rooms" table ON
