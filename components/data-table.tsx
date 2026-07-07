type TableProps = {
  columns: string[];
  rows: Record<string, unknown>[];
  emptyLabel: string;
};

function renderCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

export function DataTable({ columns, rows, emptyLabel }: TableProps) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${columns.join("-")}`}>
              {columns.map((column) => (
                <td key={column}>{renderCellValue(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}