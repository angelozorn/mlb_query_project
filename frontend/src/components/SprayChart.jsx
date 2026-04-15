const WIDTH = 500;
const HEIGHT = 500;
const HOME_X = WIDTH / 2;
const HOME_Y = 440;
const SCALE = 1.8;

const EVENT_COLORS = {
    home_run: "#ef4444",
    triple: "#f97316",
    double: "#eab308",
    single: "#22c55e",
    field_out: "#60a5fa",
    grounded_into_double_play: "#3b82f6",
    force_out: "#818cf8",
    sac_fly: "#a78bfa",
    fielders_choice: "#c084fc",
    lineout: "#60a5fa",
    flyout: "#60a5fa",
    pop_out: "#93c5fd",
};
const DEFAULT_COLOR = "#94a3b8";

function toSvg(hc_x, hc_y) {
    return {
        x: HOME_X + (hc_x - 125.42) * SCALE,
        y: HOME_Y - (199.27 - hc_y) * SCALE,
    };
}

export default function SprayChart({ data, config }) {
    const colorBy = config.colorBy || "events";

    const uniqueEvents = [...new Set(data.map(d => d[colorBy]).filter((v) => v != null && v !== ""))];
    const legendItems = uniqueEvents
        .map((e) => {
            const key = String(e);
            return { label: key.replace(/_/g, " "), color: EVENT_COLORS[key] || DEFAULT_COLOR };
        })
        .slice(0, 8);

    return (
        <div className="spray-chart-wrapper">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="spray-chart">
                {/* Outfield grass arc */}
                <path
                    d={`M ${HOME_X - 230} ${HOME_Y}
                        A 230 230 0 0 1 ${HOME_X + 230} ${HOME_Y}
                        L ${HOME_X} ${HOME_Y} Z`}
                    fill="#1a4d1a"
                    opacity="0.4"
                />

                {/* Infield dirt diamond */}
                <polygon
                    points={`${HOME_X},${HOME_Y}
                             ${HOME_X + 90},${HOME_Y - 90}
                             ${HOME_X},${HOME_Y - 180}
                             ${HOME_X - 90},${HOME_Y - 90}`}
                    fill="#8B7355"
                    opacity="0.25"
                />

                {/* Foul lines */}
                <line x1={HOME_X} y1={HOME_Y} x2={HOME_X - 230} y2={HOME_Y - 230}
                    stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                <line x1={HOME_X} y1={HOME_Y} x2={HOME_X + 230} y2={HOME_Y - 230}
                    stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />

                {/* Base paths */}
                <polygon
                    points={`${HOME_X},${HOME_Y}
                             ${HOME_X + 65},${HOME_Y - 65}
                             ${HOME_X},${HOME_Y - 130}
                             ${HOME_X - 65},${HOME_Y - 65}`}
                    fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"
                />

                {/* Bases */}
                {[
                    [HOME_X, HOME_Y],
                    [HOME_X + 65, HOME_Y - 65],
                    [HOME_X, HOME_Y - 130],
                    [HOME_X - 65, HOME_Y - 65],
                ].map(([bx, by], i) => (
                    <rect key={i} x={bx - 5} y={by - 5} width={10} height={10}
                        fill="white" transform={`rotate(45,${bx},${by})`} />
                ))}

                {/* Batted ball dots */}
                {data.map((row, i) => {
                    if (row.hc_x == null || row.hc_y == null) return null;
                    const { x, y } = toSvg(row.hc_x, row.hc_y);
                    if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) return null;
                    const color = EVENT_COLORS[String(row[colorBy])] || DEFAULT_COLOR;
                    return (
                        <circle key={i} cx={x} cy={y} r={4}
                            fill={color} opacity={0.75} stroke={color} strokeWidth={0.5}>
                            <title>
                                {`${row.events || "in play"} | EV: ${row.launch_speed ?? "—"} mph | ${row.hit_distance ?? "—"} ft`}
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
