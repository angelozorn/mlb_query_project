import { useState } from "react";

const PAGE_SIZE = 25;

export default function ResultsTable({ data }) {
    const [page, setPage] = useState(0);

    if (!data || data.length === 0) {
        return <div className="results-table empty">No results returned.</div>;
    }

    const columns = Object.keys(data[0]);
    const totalPages = Math.ceil(data.length / PAGE_SIZE);
    const pageData = data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    function formatCell(value) {
        if (value == null) return "\u2014";
        if (typeof value === "number") {
            return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3);
        }
        return String(value);
    }

    return (
        <div className="results-table">
            <div className="table-info">
                <span className="row-count">
                    {data.length.toLocaleString()} row{data.length !== 1 ? "s" : ""}
                </span>
                {totalPages > 1 && (
                    <div className="pagination">
                        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                            &larr; Prev
                        </button>
                        <span className="page-info">
                            Page {page + 1} of {totalPages}
                        </span>
                        <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                            Next &rarr;
                        </button>
                    </div>
                )}
            </div>
            <div className="table-scroll">
                <table>
                    <thead>
                        <tr>
                            {columns.map(col => (
                                <th key={col}>{col.replace(/_/g, " ")}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {pageData.map((row, i) => (
                            <tr key={i}>
                                {columns.map(col => (
                                    <td key={col}>{formatCell(row[col])}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
