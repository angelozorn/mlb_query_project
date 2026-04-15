const WIDTH = 400;
const HEIGHT = 500;
const PADDING = 60;

const ZONE_LEFT = -0.83;
const ZONE_RIGHT = 0.83;
const ZONE_BOT = 1.5;
const ZONE_TOP = 3.5;

const VIEW_X_MIN = -2.0;
const VIEW_X_MAX = 2.0;
const VIEW_Z_MIN = 0.5;
const VIEW_Z_MAX = 4.5;

const DESCRIPTION_COLORS = {
    called_strike: "#ef4444",
    swinging_strike: "#f97316",
    swinging_strike_blocked: "#fb923c",
    foul: "#eab308",
    foul_tip: "#eab308",
    ball: "#3b82f6",
    blocked_ball: "#60a5fa",
    hit_into_play: "#22c55e",
    hit_into_play_score: "#16a34a",
    hit_into_play_no_out: "#4ade80",
};
const DEFAULT_COLOR = "#94a3b8";

function toSvg(plate_x, plate_z) {
    const x = PADDING + ((plate_x - VIEW_X_MIN) / (VIEW_X_MAX - VIEW_X_MIN)) * (WIDTH - 2 * PADDING);
    const y = PADDING + ((VIEW_Z_MAX - plate_z) / (VIEW_Z_MAX - VIEW_Z_MIN)) * (HEIGHT - 2 * PADDING);
    return { x, y };
}

export default function StrikeZone({ data, config }) {
    const colorBy = config.colorBy || "description";

    const zoneTopLeft = toSvg(ZONE_LEFT, ZONE_TOP);
    const zoneBotRight = toSvg(ZONE_RIGHT, ZONE_BOT);
    const zoneW = zoneBotRight.x - zoneTopLeft.x;
    const zoneH = zoneBotRight.y - zoneTopLeft.y;

    const uniqueTypes = [...new Set(data.map(d => d[colorBy]).filter(Boolean))];
    const legendItems = uniqueTypes
        .map(t => ({ label: t.replace(/_/g, " "), color: DESCRIPTION_COLORS[t] || DEFAULT_COLOR }))
        .slice(0, 8);

    const homePlate = toSvg(0, 0.5);
    const plateW = toSvg(ZONE_RIGHT, 0).x - toSvg(ZONE_LEFT, 0).x;

    return (
        <div className="strike-zone-wrapper">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="strike-zone">
                {/* Strike zone rectangle */}
                <rect x={zoneTopLeft.x} y={zoneTopLeft.y}
                    width={zoneW} height={zoneH}
                    fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />

                {/* Zone grid (3x3) */}
                {[1, 2].map(i => {
                    const gy = zoneTopLeft.y + (zoneH / 3) * i;
                    return <line key={`h${i}`} x1={zoneTopLeft.x} y1={gy}
                        x2={zoneBotRight.x} y2={gy}
                        stroke="rgba(255,255,255,0.15)" strokeWidth="1" />;
                })}
                {[1, 2].map(i => {
                    const gx = zoneTopLeft.x + (zoneW / 3) * i;
                    return <line key={`v${i}`} x1={gx} y1={zoneTopLeft.y}
                        x2={gx} y2={zoneBotRight.y}
                        stroke="rgba(255,255,255,0.15)" strokeWidth="1" />;
                })}

                {/* Home plate pentagon */}
                <polygon
                    points={`
                        ${homePlate.x - plateW / 2},${homePlate.y}
                        ${homePlate.x + plateW / 2},${homePlate.y}
                        ${homePlate.x + plateW / 2},${homePlate.y + 8}
                        ${homePlate.x},${homePlate.y + 16}
                        ${homePlate.x - plateW / 2},${homePlate.y + 8}
                    `}
                    fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.4)" strokeWidth="1"
                />

                {/* Pitch dots */}
                {data.map((row, i) => {
                    if (row.plate_x == null || row.plate_z == null) return null;
                    const { x, y } = toSvg(row.plate_x, row.plate_z);
                    const color = DESCRIPTION_COLORS[row[colorBy]] || DEFAULT_COLOR;
                    return (
                        <circle key={i} cx={x} cy={y} r={4}
                            fill={color} opacity={0.7} stroke={color} strokeWidth={0.5}>
                            <title>
                                {`${row.description || row.type || ""} | ${row.pitch_name || row.pitch_type || ""} | ${row.release_speed ?? "—"} mph`}
                            </title>
                        </circle>
                    );
                })}
            </svg>

            {legendItems.length > 0 && (
                <div className="chart-legend">
                    {legendItems.map((item, i) => (
                        <span key={i} className="legend-item">
                            <span className="legend-dot" style={{ background: item.color }} />
                            {item.label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
