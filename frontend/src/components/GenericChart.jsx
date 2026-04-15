import {
    BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell
} from "recharts";

const COLORS = [
    "#3b82f6", "#22c55e", "#f97316", "#ef4444", "#a855f7",
    "#06b6d4", "#eab308", "#ec4899", "#14b8a6", "#f43f5e",
];

function buildHistogramData(data, key, bins = 20) {
    const values = data.map(d => Number(d[key])).filter(v => !isNaN(v));
    if (values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const binWidth = (max - min) / bins || 1;

    const counts = new Array(bins).fill(0);
    values.forEach(v => {
        const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
        counts[idx]++;
    });

    return counts.map((count, i) => ({
        range: `${(min + i * binWidth).toFixed(1)}`,
        count,
    }));
}

export default function GenericChart({ data, config, type }) {
    const { xAxis, yAxis, colorBy } = config;

    const chartData = type === "histogram"
        ? buildHistogramData(data, xAxis || yAxis)
        : data;

    const commonProps = {
        margin: { top: 10, right: 30, left: 10, bottom: 30 },
    };

    const uniqueGroups = colorBy
        ? [...new Set(data.map(d => d[colorBy]).filter(Boolean))]
        : [];

    if (type === "bar" || type === "histogram") {
        const xKey = type === "histogram" ? "range" : xAxis;
        const yKey = type === "histogram" ? "count" : yAxis;

        return (
            <div className="generic-chart">
                <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={chartData} {...commonProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey={xKey} stroke="#8899aa" tick={{ fill: "#8899aa", fontSize: 12 }}
                            angle={-35} textAnchor="end" height={60} />
                        <YAxis stroke="#8899aa" tick={{ fill: "#8899aa", fontSize: 12 }} />
                        <Tooltip
                            contentStyle={{ background: "#1a2332", border: "1px solid #2a3a4e", borderRadius: 8, color: "#e8edf2" }}
                            labelStyle={{ color: "#8899aa" }}
                        />
                        <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
                            {chartData.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    }

    if (type === "line") {
        return (
            <div className="generic-chart">
                <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={chartData} {...commonProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey={xAxis} stroke="#8899aa" tick={{ fill: "#8899aa", fontSize: 12 }}
                            angle={-35} textAnchor="end" height={60} />
                        <YAxis stroke="#8899aa" tick={{ fill: "#8899aa", fontSize: 12 }} />
                        <Tooltip
                            contentStyle={{ background: "#1a2332", border: "1px solid #2a3a4e", borderRadius: 8, color: "#e8edf2" }}
                            labelStyle={{ color: "#8899aa" }}
                        />
                        <Legend wrapperStyle={{ color: "#8899aa" }} />
                        <Line type="monotone" dataKey={yAxis} stroke={COLORS[0]}
                            strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        );
    }

    if (type === "scatter") {
        return (
            <div className="generic-chart">
                <ResponsiveContainer width="100%" height={400}>
                    <ScatterChart {...commonProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey={xAxis} name={xAxis} stroke="#8899aa"
                            tick={{ fill: "#8899aa", fontSize: 12 }} type="number" />
                        <YAxis dataKey={yAxis} name={yAxis} stroke="#8899aa"
                            tick={{ fill: "#8899aa", fontSize: 12 }} type="number" />
                        <Tooltip
                            contentStyle={{ background: "#1a2332", border: "1px solid #2a3a4e", borderRadius: 8, color: "#e8edf2" }}
                            labelStyle={{ color: "#8899aa" }}
                            cursor={{ strokeDasharray: "3 3" }}
                        />
                        {uniqueGroups.length > 0 ? (
                            uniqueGroups.map((group, gi) => (
                                <Scatter key={group} name={group} fill={COLORS[gi % COLORS.length]}
                                    data={chartData.filter(d => d[colorBy] === group)} />
                            ))
                        ) : (
                            <Scatter data={chartData} fill={COLORS[0]} />
                        )}
                        {uniqueGroups.length > 0 && <Legend wrapperStyle={{ color: "#8899aa" }} />}
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        );
    }

    return null;
}
