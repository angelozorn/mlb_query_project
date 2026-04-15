-- Run this in the Supabase SQL Editor (or as a migration) so the app can execute AI-generated SELECTs.
-- statement_timeout: API queries are capped (~60s max on hosted Supabase); this uses the allowed maximum.
-- If you still hit timeouts, narrow queries (see frontend schemaContext) or add indexes on filter columns.

CREATE OR REPLACE FUNCTION execute_sql(query_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO '60s'
AS $$
DECLARE
    result JSON;
    q TEXT;
BEGIN
    q := trim(both FROM query_text);
    q := regexp_replace(q, ';\s*$', '');

    IF NOT (
        lower(q) LIKE 'select%' OR lower(q) LIKE 'with%'
    ) THEN
        RAISE EXCEPTION 'Only SELECT queries (optionally starting with WITH) are allowed';
    END IF;

    IF q ILIKE '%insert%' OR
       q ILIKE '%update%' OR
       q ILIKE '%delete%' OR
       q ILIKE '%drop%' OR
       q ILIKE '%alter%' OR
       q ILIKE '%create%' OR
       q ILIKE '%truncate%' THEN
        RAISE EXCEPTION 'Query contains forbidden keywords';
    END IF;

    EXECUTE 'SELECT json_agg(row_to_json(t)) FROM (' || q || ') t'
    INTO result;

    RETURN COALESCE(result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION execute_sql(TEXT) TO anon, authenticated;
