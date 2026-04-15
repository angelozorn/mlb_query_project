import { useState } from "react";

const EXAMPLE_QUERIES = [
    "Show me all home runs hit by Aaron Judge in 2025",
    "What is the average exit velocity by pitch type for the Yankees?",
    "Show me Shohei Ohtani's spray chart for the 2025 season",
    "Which pitchers throw the hardest fastballs?",
    "Plot the strike zone for all called strikes against left-handed batters",
    "How has Gerrit Cole's fastball velocity trended over the 2025 season?",
    "Show me barrel rate by team in 2025",
    "Which batters have the most batted balls over 110 mph?",
    "Show me the pitch mix breakdown for Spencer Strider",
];

export default function QueryInput({ onSubmit, loading }) {
    const [value, setValue] = useState("");

    function handleSubmit(e) {
        e.preventDefault();
        if (value.trim() && !loading) {
            onSubmit(value.trim());
        }
    }

    function handleExampleClick(q) {
        setValue(q);
        onSubmit(q);
    }

    return (
        <div className="query-input">
            <form onSubmit={handleSubmit}>
                <div className="input-row">
                    <textarea
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Ask anything about MLB Statcast data..."
                        rows={2}
                        disabled={loading}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e);
                            }
                        }}
                    />
                    <button type="submit" disabled={loading || !value.trim()}>
                        {loading ? (
                            <span className="btn-loading">
                                <span className="spinner-sm" />
                                Querying...
                            </span>
                        ) : (
                            "Query"
                        )}
                    </button>
                </div>
            </form>
            <div className="examples">
                <span className="examples-label">Try an example:</span>
                <div className="example-chips">
                    {EXAMPLE_QUERIES.map((q, i) => (
                        <button
                            key={i}
                            className="chip"
                            onClick={() => handleExampleClick(q)}
                            disabled={loading}
                        >
                            {q}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
