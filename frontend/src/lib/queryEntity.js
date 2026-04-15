/**
 * Classifies a natural-language question so SQL targets either batters or pitchers, not both.
 * Pitching patterns are checked first so phrases like "hits allowed" do not become batter queries.
 */

/** @typedef {'batter' | 'pitcher' | 'neutral'} QueryEntity */

/**
 * @param {string} question
 * @returns {QueryEntity}
 */
export function classifyQueryEntity(question) {
    const t = question.toLowerCase();

    if (isPitchingQuestion(t)) return "pitcher";
    if (isHittingQuestion(t)) return "batter";
    return "neutral";
}

/**
 * @param {string} t lowercase text
 */
function isPitchingQuestion(t) {
    if (
        /\b(most|fewest|top|leader|leaders|leading|who (had|has|led))\b/.test(t) &&
        /\bstrikeouts?\b/.test(t) &&
        !/\bbatter(s)?\b/.test(t) &&
        !/\b(struck out most|times (he |she |they )?struck)\b/.test(t)
    ) {
        return true;
    }
    if (
        /\b(gave up|surrendered|allowed)\b/.test(t) &&
        /\b(homer|homers|hr\b|hits?|triples?|doubles?|singles?|runs?|home runs?|earned runs?)\b/.test(t)
    ) {
        return true;
    }
    if (/\b(which|what) pitchers?\b/.test(t) && /\b(allow|gave|give|surrender|most|fewest|lead|leader|top)\b/.test(t)) {
        return true;
    }
    if (
        /\bhit off\b/.test(t) ||
        /\boff (which |what )?pitcher\b/.test(t) ||
        /\bagainst (which |what )?pitcher\b/.test(t) ||
        /\bfrom (which |what )?pitcher\b/.test(t)
    ) {
        return true;
    }
    if (/\b(era\b|whip\b|batting average against|baa\b|opponent average|runs allowed)\b/.test(t)) {
        return true;
    }
    if (
        /\b(pitchers?|pitcher)\b/.test(t) &&
        /\b(strikeouts?|k\b|ks\b|velocity|velo|spin|whiff|chase|arsenal|pitch mix|release)\b/.test(t) &&
        !/\bbatter(s)?\b/.test(t)
    ) {
        return true;
    }
    if (/\b(most|fewest|top) (strikeouts|ks)\b/.test(t) && /\bpitcher/.test(t)) {
        return true;
    }
    if (/\bpitching\b/.test(t) && /\b(stats?|leader|leaders|rank|most|fewest)\b/.test(t) && !/\b(batting|hitter|batter)\b/.test(t)) {
        return true;
    }
    return false;
}

/**
 * @param {string} t lowercase text
 */
function isHittingQuestion(t) {
    if (/\b(which|what) batter(s)?\b/.test(t)) return true;
    if (/\bwho (hit|had|has)\b/.test(t) && !/\b(hit off|against pitcher|off which pitcher)\b/.test(t)) {
        if (/\bstrikeouts?\b/.test(t) && !/\bbatter(s)?\b/.test(t)) return false;
        return true;
    }
    if (/\b(hitter|hitters|batting order|at[- ]bat|plate appearances?|offensive|offense|slugging|barrel|barrels)\b/.test(t)) {
        return true;
    }
    if (/\b(rbis?\b|rbi\b|walks drawn|times on base)\b/.test(t)) return true;
    if (/\b(batting average|batting avg|obp\b|ops\b|woba\b)\b/.test(t) && !/\bagainst\b/.test(t)) return true;
    if (
        /\bmost (triples|doubles|singles|home runs?|homers?|hits|walks|rbis?)\b/.test(t) &&
        !/\b(allowed|gave up|surrendered)\b/.test(t)
    ) {
        return true;
    }
    if (
        /\bleader (in|for)\b/.test(t) &&
        /\b(hits|triples|doubles|singles|home|homers?|hr\b|walks|rbis?)\b/.test(t) &&
        !/\b(allowed|gave up|pitcher)\b/.test(t)
    ) {
        return true;
    }
    if (/\bstrikeouts?\b/.test(t) && /\bbatter(s)?\b/.test(t) && !/\bpitcher(s)?\b/.test(t)) return true;
    if (/\b(spray chart|exit velo|launch angle|batted ball)\b/.test(t) && !/\bpitcher\b/.test(t)) return true;
    return false;
}

/**
 * Hard constraints appended to the user message (not the schema) so the model cannot blend roles.
 * @param {QueryEntity} entity
 * @returns {string}
 */
export function buildEntityLockBlock(entity) {
    if (entity === "batter") {
        return `

=== ENTITY LOCK: BATTERS / HITTING ONLY (mandatory) ===
The question is about hitting. The result set must describe ONE batter per leaderboard row.

Rules (use this pattern — do NOT join the players table for batter names):
- FROM pitches p. For each pitch row, p.player_name is the batter's canonical name (Chadwick); it matches p.batter.
- SELECT MAX(p.player_name) AS player_name (or batter_name), COUNT(*) AS metric, and include p.batter in GROUP BY.
- GROUP BY p.batter only (plus optional HAVING). Do NOT GROUP BY p.pitcher.
- Do NOT JOIN players bat or players pit for batting leaderboards — the players table can be stale; p.player_name is authoritative for the batter on that row.
- Do NOT SELECT pit.player_name or list pitcher names as the primary column.
- You may filter with p.pitcher in WHERE without joining pitchers' names.`;
    }
    if (entity === "pitcher") {
        return `

=== ENTITY LOCK: PITCHERS / PITCHING ONLY (mandatory) ===
The question is about pitching (including what pitchers allowed). The result set must describe ONE pitcher per leaderboard row.

Rules:
- FROM pitches p. JOIN players pit ON pit.player_id = p.pitcher for the displayed name.
- GROUP BY must include p.pitcher (and pit.player_name only if dependent on pitcher id). Do NOT GROUP BY p.batter or bat.player_id for rankings.
- SELECT the pitcher's name as pit.player_name (or equivalent). Do NOT list batter names as the primary player column.
- You may filter with p.batter in WHERE, but the answer dimension is always the pitcher.
- Do NOT use pitches.player_name for grouping or as the main label.
- Use a single players join alias "pit" for pitchers only (no "bat" join unless strictly needed for a filter only — prefer WHERE on p.batter without selecting batter name).`;
    }
    return "";
}

/**
 * Extract GROUP BY clause fragments (best-effort; good enough for LLM-shaped SQL).
 * @param {string} sql
 * @returns {string[]}
 */
function extractGroupByClauses(sql) {
    const lower = sql.toLowerCase();
    const out = [];
    let i = 0;
    while (i < lower.length) {
        const idx = lower.indexOf("group by", i);
        if (idx === -1) break;
        let j = idx + 8;
        while (j < lower.length && /\s/.test(lower[j])) j++;
        let depth = 0;
        let k = j;
        for (; k < lower.length; k++) {
            const ch = lower[k];
            if (ch === "(") depth++;
            else if (ch === ")") depth = Math.max(0, depth - 1);
            else if (depth === 0) {
                const rest = lower.slice(k);
                if (/^\border\b/.test(rest) || /^\blimit\b/.test(rest) || /^\bhaving\b/.test(rest)) break;
            }
        }
        out.push(lower.slice(j, k).trim());
        i = k;
    }
    return out;
}

const PITCHER_GROUP = /\b(p\.)?pitcher\b/;
const BATTER_GROUP = /\b(p\.)?batter\b/;

/**
 * @param {string} sql
 * @returns {string | null}
 */
function extractSelectList(sql) {
    const re = /select\s+([\s\S]+?)\s+from\s+/gi;
    let last = null;
    let m;
    while ((m = re.exec(sql)) !== null) {
        last = m[1];
    }
    return last;
}

/**
 * @param {string} sql
 * @param {QueryEntity} entity
 * @returns {boolean} true if SQL breaks the entity lock
 */
export function sqlViolatesEntityLock(sql, entity) {
    if (entity === "neutral") return false;

    if (entity === "batter" && /\bjoin\s+players\s+(as\s+)?bat\b/i.test(sql)) return true;

    const selectList = extractSelectList(sql);
    if (selectList) {
        if (entity === "batter" && /\bpit\.player_name\b/i.test(selectList)) return true;
        if (entity === "pitcher" && /\bbat\.player_name\b/i.test(selectList)) return true;
    }

    const clauses = extractGroupByClauses(sql);
    if (clauses.length === 0) return false;

    for (const c of clauses) {
        const hasPitcher = PITCHER_GROUP.test(c);
        const hasBatter = BATTER_GROUP.test(c);
        if (entity === "batter" && hasPitcher && !hasBatter) return true;
        if (entity === "pitcher" && hasBatter && !hasPitcher) return true;
    }
    return false;
}
