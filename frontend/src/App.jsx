import { useState, useEffect } from "react";
import { executeQuery } from "./lib/supabase";
import { generateSQL, determineVisualization } from "./lib/aiQueryEngine";
import { classifyQueryEntity } from "./lib/queryEntity";
import { SCHEMA_CONTEXT } from "./lib/schemaContext";
import QueryInput from "./components/QueryInput";
import SQLDisplay from "./components/SQLDisplay";
import ResultsTable from "./components/ResultsTable";
import VisualizationEngine from "./components/VisualizationEngine";
import LoadingSpinner from "./components/LoadingSpinner";

const STEPS = [
    "Generating SQL from your question...",
    "Executing query against Statcast database...",
    "Analyzing results for best visualization...",
];

export default function App() {
    const [query, setQuery] = useState("");
    const [sqlQuery, setSqlQuery] = useState("");
    const [results, setResults] = useState(null);
    const [vizConfig, setVizConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingStep, setLoadingStep] = useState(0);
    const [error, setError] = useState(null);
    const [apiKey, setApiKey] = useState(() => localStorage.getItem("claude_api_key") || "");
    const [showApiKey, setShowApiKey] = useState(false);

    useEffect(() => {
        if (apiKey) {
            localStorage.setItem("claude_api_key", apiKey);
        }
    }, [apiKey]);

    async function handleSubmit(userQuestion) {
        if (!apiKey) {
            setError("Please enter your Claude API key first.");
            return;
        }

        setQuery(userQuestion);
        setLoading(true);
        setLoadingStep(0);
        setError(null);
        setSqlQuery("");
        setResults(null);
        setVizConfig(null);

        try {
            setLoadingStep(0);
            const entity = classifyQueryEntity(userQuestion);
            const sql = await generateSQL(userQuestion, apiKey, SCHEMA_CONTEXT);
            setSqlQuery(sql);

            setLoadingStep(1);
            const data = await executeQuery(sql);
            setResults(data || []);

            if (data && data.length > 0) {
                setLoadingStep(2);
                const columns = Object.keys(data[0]);
                const viz = await determineVisualization(
                    userQuestion, sql, columns, data, apiKey, entity
                );
                setVizConfig(viz);
            }
        } catch (err) {
            setError(err.message || "An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="app">
            <header className="header">
                <div className="header-content">
                    <div className="header-left">
                        <h1>Statcast AI</h1>
                        <span className="header-tagline">Natural language queries for MLB pitch data</span>
                    </div>
                    <div className="header-right">
                        <div className="api-key-section">
                            <label htmlFor="api-key">Claude API Key</label>
                            <div className="api-key-input-row">
                                <input
                                    id="api-key"
                                    type={showApiKey ? "text" : "password"}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="sk-ant-..."
                                />
                                <button
                                    className="toggle-visibility"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    type="button"
                                >
                                    {showApiKey ? "Hide" : "Show"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="main">
                <QueryInput onSubmit={handleSubmit} loading={loading} />

                {loading && (
                    <LoadingSpinner message={STEPS[loadingStep] || "Processing..."} />
                )}

                {error && (
                    <div className="error-display">
                        <strong>Error:</strong> {error}
                    </div>
                )}

                {sqlQuery && !loading && <SQLDisplay sql={sqlQuery} />}

                {vizConfig && results && !loading && (
                    <VisualizationEngine config={vizConfig} data={results} />
                )}

                {results && !loading && <ResultsTable data={results} />}
            </main>

            <footer className="footer">
                <p>
                    Powered by <a href="https://baseballsavant.mlb.com" target="_blank" rel="noreferrer">Baseball Savant</a> Statcast data
                    &middot; AI by <a href="https://anthropic.com" target="_blank" rel="noreferrer">Claude</a>
                </p>
            </footer>
        </div>
    );
}
