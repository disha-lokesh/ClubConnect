-- ClubConnect | Migration 005 | Per-request session validation
-- The API calls this on every request so a deactivated account loses access immediately,
-- even while its signed session cookie is still within its lifetime.
CREATE FUNCTION session_check(p_user_id BIGINT)
RETURNS TABLE (role VARCHAR, full_name VARCHAR, is_active BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.role, u.full_name, u.is_active FROM users u WHERE u.user_id = p_user_id
$$;
REVOKE EXECUTE ON FUNCTION session_check(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION session_check(BIGINT) TO clubconnect_app;
