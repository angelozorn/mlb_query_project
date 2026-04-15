import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * The Supabase execute_sql RPC wraps query_text as a subquery:
 *   SELECT ... FROM ( <query_text> ) t
 * A trailing semicolon makes the inner fragment invalid ("syntax error at or near ';'").
 */
function normalizeQueryText(sql) {
    let s = sql.trim();
    while (s.endsWith(";")) {
        s = s.slice(0, -1).trim();
    }
    return s;
}

/**
 * Execute a raw SQL query via the execute_sql database function.
 * This function only permits SELECT statements (enforced server-side).
 */
export async function executeQuery(sql) {
    const query_text = normalizeQueryText(sql);
    const { data, error } = await supabase.rpc("execute_sql", {
        query_text
    });

    if (error) {
        const msg = error.message || "";
        if (/statement timeout|canceling statement due to statement timeout/i.test(msg)) {
            throw new Error(
                "That query took too long for the database time limit. Try a narrower question (date range, season, team, or player) or fewer rows. If you manage Supabase, run the SQL in supabase/execute_sql.sql so this RPC can use a longer statement timeout (up to the host cap, often 60s)."
            );
        }
        throw error;
    }
    return data;
}
