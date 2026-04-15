import SprayChart from "./SprayChart";
import StrikeZone from "./StrikeZone";
import GenericChart from "./GenericChart";

export default function VisualizationEngine({ config, data }) {
    if (!config || !data || data.length === 0) return null;

    const { type, title, description } = config;

    if (type === "table_only") return null;

    return (
        <div className="visualization">
            {title && <h3 className="viz-title">{title}</h3>}
            {description && <p className="viz-description">{description}</p>}
            <div className="viz-container">
                {type === "spray_chart" && <SprayChart data={data} config={config} />}
                {type === "strike_zone" && <StrikeZone data={data} config={config} />}
                {type === "bar_chart" && <GenericChart data={data} config={config} type="bar" />}
                {type === "line_chart" && <GenericChart data={data} config={config} type="line" />}
                {type === "scatter_plot" && <GenericChart data={data} config={config} type="scatter" />}
                {type === "histogram" && <GenericChart data={data} config={config} type="histogram" />}
            </div>
        </div>
    );
}
