"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parse as parseCsvSync } from "csv-parse/browser/esm/sync";
import { DataTable } from "./data-table";
import type { ImportResponse } from "../shared/crm";

type CsvPreview = {
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
  displayedRows: number;
};

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

function isCsvFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  return lowerName.endsWith(".csv") || mimeType === "text/csv" || mimeType === "application/vnd.ms-excel";
}

function validateCsvFile(file: File): string | null {
  if (!isCsvFile(file)) {
    return "Please upload a valid CSV file.";
  }

  return null;
}

function repairUnbalancedQuoteLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const quoteCount = (line.match(/"/g) ?? []).length;

      if (quoteCount > 0 && quoteCount % 2 === 1) {
        return `${line}"`;
      }

      return line;
    })
    .join("\n");
}

async function parseCsv(file: File): Promise<CsvPreview> {
  const text = await file.text();
  const attempts = [text, repairUnbalancedQuoteLines(text)];

  let lastError: unknown = null;

  for (const candidateText of attempts) {
    try {
      const rows = parseCsvSync(candidateText, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        trim: true
      }) as Record<string, string>[];

      const normalizedRows = rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim().length > 0));
      const columns = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : [];

      if (columns.length > 0 || normalizedRows.length > 0) {
        return { columns, rows: normalizedRows.slice(0, 25), totalRows: normalizedRows.length, displayedRows: Math.min(25, normalizedRows.length) };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to parse CSV.");
}

export function ImportWorkflow() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [response, setResponse] = useState<ImportResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<"upload" | "preview" | "processing" | "done">("upload");
  const [estimatedBatch, setEstimatedBatch] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (preview) {
      setPhase("preview");
    }
  }, [preview]);

  async function handleSelectedFile(selectedFile: File) {
    setUploadError(null);
    setResponse(null);

    const validationError = validateCsvFile(selectedFile);
    if (validationError) {
      setFile(null);
      setPreview(null);
      setPhase("upload");
      setUploadError(validationError);
      return;
    }

    setFile(selectedFile);
    setPhase("upload");

    try {
      const parsedPreview = await parseCsv(selectedFile);
      setPreview(parsedPreview);
      setPhase("preview");
    } catch (error) {
      setPreview(null);
      setUploadError(error instanceof Error ? error.message : "Unable to parse the selected CSV.");
    }
  }

  async function confirmImport() {
    if (!file) {
      return;
    }

    setIsProcessing(true);
    setUploadError(null);
    setPhase("processing");
    setEstimatedBatch(1);

    const totalEstimatedBatches = preview ? Math.max(1, Math.ceil(preview.totalRows / 20)) : 1;
    const batchTicker = window.setInterval(() => {
      setEstimatedBatch((currentBatch) => Math.min(totalEstimatedBatches, currentBatch + 1));
    }, 900);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const request = await fetch(`${getApiBaseUrl()}/api/import`, {
        method: "POST",
        body: formData
      });

      if (!request.ok) {
        const payload = (await request.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Import failed on the backend.");
      }

      const payload = (await request.json()) as ImportResponse;
      setResponse(payload);
      setPhase("done");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Something went wrong while importing.");
      setPhase("preview");
    } finally {
      window.clearInterval(batchTicker);
      setEstimatedBatch(0);
      setIsProcessing(false);
    }
  }

  const importedColumns = useMemo(() => {
    if (!response?.records.length) {
      return [];
    }

    return Object.keys(response.records[0]).filter((key) => key !== "source_row_index");
  }, [response]);

  const skippedColumns = useMemo(() => {
    if (!response?.skippedRecords.length) {
      return [];
    }

    return Object.keys(response.skippedRecords[0]);
  }, [response]);

  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">AI-powered CRM importer</span>
        <h1 className="title">Turn messy CSVs into GrowEasy CRM records.</h1>
        <p className="subtitle">
          Upload Facebook lead exports, Google Ads sheets, real estate dumps, or manually maintained spreadsheets.
          Preview the raw file first, then let the backend use AI to map every column into the GrowEasy CRM format.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <div className="card-inner stack">
            <div className="status">
              <span className={`status-dot ${isProcessing ? "loading" : uploadError ? "error" : ""}`} />
              <span>
                {isProcessing
                  ? `Processing batch ${estimatedBatch || 1} of ${preview ? Math.max(1, Math.ceil(preview.totalRows / 20)) : 1}`
                  : phase === "done"
                    ? "Import completed"
                    : preview
                      ? "Preview ready"
                      : "Waiting for CSV upload"}
              </span>
            </div>

            <div
              className="dropzone"
              data-active={isDragging}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const droppedFile = event.dataTransfer.files[0];
                if (droppedFile) {
                  void handleSelectedFile(droppedFile);
                }
              }}
            >
              <div>
                <strong>Drag and drop a CSV file here</strong>
                <p>Or use the file picker. The first AI call only happens after you confirm the import.</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0];
                  if (selectedFile) {
                    void handleSelectedFile(selectedFile);
                  }
                }}
              />
            </div>

            <div className="button-row">
              <button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()}>
                Choose file
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void confirmImport()}
                disabled={!preview || isProcessing}
              >
                {isProcessing ? "Importing..." : "Confirm Import"}
              </button>
            </div>

            {file ? (
              <div className="pill-row">
                <span className="pill">
                  <strong>File:</strong> {file.name}
                </span>
                <span className="pill">
                  <strong>Size:</strong> {(file.size / 1024).toFixed(1)} KB
                </span>
                {preview ? (
                  <span className="pill">
                    <strong>Preview rows:</strong> {preview.displayedRows} of {preview.totalRows}
                  </span>
                ) : null}
              </div>
            ) : null}

            {uploadError ? <div className="alert">{uploadError}</div> : null}
          </div>
        </article>

        <aside className="card">
          <div className="card-inner stack">
            <h2 className="section-title">Workflow</h2>
            <div className="meta-grid">
              <div className="meta-item">
                <span className="meta-label">Step 1</span>
                <span className="meta-value">Upload CSV</span>
                <p className="muted">Drag and drop or choose a file. We only parse locally at this stage.</p>
              </div>
              <div className="meta-item">
                <span className="meta-label">Step 2</span>
                <span className="meta-value">Preview rows</span>
                <p className="muted">Inspect the raw data in a responsive table with sticky headers.</p>
              </div>
              <div className="meta-item">
                <span className="meta-label">Step 3</span>
                <span className="meta-value">Confirm import</span>
                <p className="muted">Only after confirmation does the backend call the LLM and normalize the records.</p>
              </div>
            </div>
          </div>
        </aside>
      </section>

      <section className="results">
        <article className="card">
          <div className="card-inner stack">
            <h2 className="section-title">CSV Preview</h2>
            {preview ? (
              <>
                <div className="pill-row" style={{ marginBottom: 12 }}>
                  <span className="pill">
                    <strong>Showing:</strong> first {preview.displayedRows} of {preview.totalRows} rows
                  </span>
                </div>
                <DataTable columns={preview.columns} rows={preview.rows} emptyLabel="No rows were detected in the file." />
              </>
            ) : (
              <div className="empty-state">Upload a CSV to see a local preview before any AI processing happens.</div>
            )}
          </div>
        </article>

        {response ? (
          <article className="card">
            <div className="card-inner stack">
              <h2 className="section-title">Parsed Result</h2>
              <div className="pill-row">
                <span className="pill">
                  <strong>Total imported:</strong> {response.importedCount}
                </span>
                <span className="pill">
                  <strong>Total skipped:</strong> {response.skippedCount}
                </span>
                <span className="pill">
                  <strong>Batches processed:</strong> {response.batchesProcessed}
                </span>
              </div>

              <div className="results-grid">
                <div className="stack">
                  <h3 className="section-title">Successfully parsed records</h3>
                  <DataTable
                    columns={importedColumns}
                    rows={response.records.map(({ source_row_index, ...record }) => record)}
                    emptyLabel="No records were imported."
                  />
                </div>

                <div className="stack">
                  <h3 className="section-title">Skipped records</h3>
                  <DataTable columns={skippedColumns} rows={response.skippedRecords} emptyLabel="No records were skipped." />
                </div>
              </div>
            </div>
          </article>
        ) : null}
      </section>
    </main>
  );
}