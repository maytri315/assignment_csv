import { parse } from "csv-parse/sync";

export type CsvRow = Record<string, string>;

export function parseCsvBuffer(buffer: Buffer): { rows: CsvRow[]; headers: string[] } {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");

  const parsed = parse(text, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true
  }) as CsvRow[];

  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  const rows = parsed.map((row) => {
    const normalizedRow: CsvRow = {};

    for (const [key, value] of Object.entries(row)) {
      normalizedRow[key.trim()] = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    }

    return normalizedRow;
  });

  return { rows, headers };
}

export function isRowEmpty(row: CsvRow): boolean {
  return Object.values(row).every((value) => String(value ?? "").trim().length === 0);
}

export function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}