import { useState } from "react";

export default function SQLDisplay({ sql }) {
    const [expanded, setExpanded] = useState(true);
    const [copied, setCopied] = useState(false);

    function handleCopy(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(sql);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="sql-display">
            <div className="sql-header" onClick={() => setExpanded(!expanded)}>
                <span className="sql-toggle">
                    <span className={`toggle-arrow ${expanded ? "open" : ""}`}>&#9654;</span>
                    Generated SQL
                </span>
                <button className="copy-btn" onClick={handleCopy}>
                    {copied ? "Copied!" : "Copy"}
                </button>
            </div>
            {expanded && (
                <pre className="sql-code"><code>{sql}</code></pre>
            )}
        </div>
    );
}
