import { buildEntityLockBlock, classifyQueryEntity, sqlViolatesEntityLock } from "./queryEntity.js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

function stripSqlFence(text) {
    let sql = text.trim();
    sql = sql.replace(/```sql\n?/gi, "").replace(/```\n?/g, "").trim();
    return sql;
}

async function requestSqlFromClaude({
    userQuestion,
    apiKey,
    systemPrompt,
    entityLockBlock,
    correctionNote,
}) {
    const parts = [
        "Generate a PostgreSQL query for the following question. Return ONLY the SQL query, no explanation.",
        entityLockBlock,
        correctionNote,
        `Question:\n${userQuestion}`,
    ].filter(Boolean);

    const response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{ role: "user", content: parts.join("\n\n") }],
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Claude API error: ${response.status}`);
    }

    const data = await response.json();
    return stripSqlFence(data.content[0].text);
}

/**
 * Convert a natural language question into a PostgreSQL query.
 * Classifies hitting vs pitching, applies an ENTITY LOCK, and retries once if SQL violates the lock.
 */
export async function generateSQL(userQuestion, apiKey, schemaContext) {
    const entity = classifyQueryEntity(userQuestion);
    const entityLockBlock = buildEntityLockBlock(entity);
    const systemAugment =
        entity !== "neutral"
            ? "\n\nIf the user message contains a section titled ENTITY LOCK, follow it exactly; it overrides any conflicting instruction in this schema for this query."
            : "";

    const systemPrompt = schemaContext + systemAugment;

    let sql = await requestSqlFromClaude({
        userQuestion,
        apiKey,
        systemPrompt,
        entityLockBlock,
        correctionNote: "",
    });

    if (entity !== "neutral" && sqlViolatesEntityLock(sql, entity)) {
        sql = await requestSqlFromClaude({
            userQuestion,
            apiKey,
            systemPrompt,
            entityLockBlock,
            correctionNote: `The SQL you generated broke the ENTITY LOCK (${entity} only). Fix it.

Problems to fix:
- For BATTING: GROUP BY p.batter only; use MAX(p.player_name) AS player_name. No JOIN players. No pit.player_name in SELECT.
- For PITCHING: GROUP BY p.pitcher; use JOIN players pit ON pit.player_id = p.pitcher and pit.player_name. No bat.player_name in SELECT.

Your invalid SQL was:
${sql}

Return ONLY the corrected SQL.`,
        });
    }

    return sql;
}

/**
 * @typedef {'batter' | 'pitcher' | 'neutral'} QueryEntity
 */

/**
 * Determine the best visualization type and config for a set of query results.
 * @param {QueryEntity} [entity]
 */
export async function determineVisualization(
    userQuestion,
    sqlQuery,
    columns,
    sampleRows,
    apiKey,
    entity = "neutral"
) {
    let entityNote = "";
    if (entity === "batter") {
        entityNote =
            "\n\nEach result row represents a batter (hitter). Titles and axis labels must describe batters, not pitchers.";
    } else if (entity === "pitcher") {
        entityNote =
            "\n\nEach result row represents a pitcher. Titles and axis labels must describe pitchers, not batters.";
    }

    const response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            system: `You are a data visualization advisor for a baseball analytics app.
Given a user's question, the SQL query that was run, and the result columns/sample data,
determine the best visualization type.

Available visualization types:
- "spray_chart": For batted ball locations on a baseball diamond. Requires hc_x and hc_y columns.
- "strike_zone": For pitch location heatmaps. Requires plate_x and plate_z columns.
- "bar_chart": For comparing categories (e.g., pitch type counts, player rankings).
- "line_chart": For trends over time (e.g., velocity over the season).
- "scatter_plot": For correlating two numeric values (e.g., exit velo vs launch angle).
- "histogram": For distribution of a single numeric value.
- "table_only": When a table is the best representation (e.g., detailed game logs).

Respond with ONLY a JSON object (no markdown, no explanation):
{
    "type": "chart_type",
    "title": "Chart Title",
    "xAxis": "column_name_for_x",
    "yAxis": "column_name_for_y",
    "colorBy": "optional_column_for_color_coding",
    "description": "One sentence explaining what the visualization shows"
}`,
            messages: [
                {
                    role: "user",
                    content: `Question: ${userQuestion}\n\nSQL Query: ${sqlQuery}\n\nResult Columns: ${JSON.stringify(columns)}\n\nSample Data (first 3 rows): ${JSON.stringify(sampleRows.slice(0, 3))}${entityNote}`,
                },
            ],
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Claude API error: ${response.status}`);
    }

    const data = await response.json();
    let text = data.content[0].text.trim();
    text = text.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
    return JSON.parse(text);
}
