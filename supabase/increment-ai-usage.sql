-- Incrémente le compteur d'usage IA de manière atomique.
-- Retourne { allowed: bool, count: int }
-- Si count >= p_limit, n'incrémente PAS et retourne allowed=false.
-- Élimine la race condition check+increment de api/chat.js.
CREATE OR REPLACE FUNCTION increment_ai_usage(
  p_user_id uuid,
  p_date    date,
  p_limit   int
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count   int;
  v_allowed boolean;
BEGIN
  -- INSERT ou UPDATE atomique, uniquement si sous la limite
  INSERT INTO ai_usage (user_id, date, count)
  VALUES (p_user_id, p_date, 1)
  ON CONFLICT (user_id, date) DO UPDATE
    SET count = ai_usage.count + 1
    WHERE ai_usage.count < p_limit
  RETURNING count INTO v_count;

  IF FOUND THEN
    -- Incrément réussi
    v_allowed := true;
  ELSE
    -- La condition WHERE a échoué → limite atteinte
    SELECT count INTO v_count
    FROM ai_usage
    WHERE user_id = p_user_id AND date = p_date;
    v_allowed := false;
  END IF;

  RETURN json_build_object('allowed', v_allowed, 'count', v_count);
END;
$$;

-- Seule la clé service_role peut appeler cette fonction
REVOKE ALL ON FUNCTION increment_ai_usage(uuid, date, int) FROM PUBLIC;
