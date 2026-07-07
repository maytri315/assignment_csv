import OpenAI from "openai";
import type { CsvRow } from "./csv.js";
import { chunkRows } from "./csv.js";
import { heuristicExtractRows } from "./heuristics.js";
import { crmDataSources, crmStatuses, importResponseSchema, normalizeCreatedAt, type ImportResponse, type ImportedCrmRecord, type SkippedRecord } from "../../shared/crm.js";

const batchSize = 20;
const maxAiRetries = 3;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function buildPrompt(fileName: string, rows: CsvRow[], startIndex: number): string {
  return [
    `File name: ${fileName}`,
    `You are converting CSV rows into GrowEasy CRM records.`,
    `Return only valid JSON with this shape: {"records":[...],"skipped_records":[...]}.`,
    `Every record must contain source_row_index and the CRM fields.`,
    `Only use these crm_status values: ${crmStatuses.join(", ")}.`,
    `Only use these data_source values when confidently matched: ${crmDataSources.join(", ")}. Otherwise leave data_source blank.`,
    `created_at must be a string that can be passed to new Date(created_at).`,
    `If a row has neither email nor mobile number, add it to skipped_records with a reason instead of records.`,
    `If multiple emails or phones exist, use the first for email/mobile_without_country_code and move the rest into crm_note.`,
    `Put useful extra text, remarks, extra numbers, and extra emails into crm_note.`,
    `Keep each record as one JSON object. Do not add markdown. Do not invent rows.`,
    `Use the provided source_row_index values exactly as given.`,
    `Input rows start at source row ${startIndex}:`,
    JSON.stringify(rows.map((row, index) => ({ source_row_index: startIndex + index, row })), null, 2)
  ].join("\n");
}

function parseJsonResponse(content: string): { records?: ImportedCrmRecord[]; skipped_records?: SkippedRecord[] } {
  const trimmed = content.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("AI response did not contain JSON.");
  }

  const jsonText = trimmed.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonText) as { records?: ImportedCrmRecord[]; skipped_records?: SkippedRecord[] };
}

function sanitizeResult(input: unknown): { records: ImportedCrmRecord[]; skippedRecords: SkippedRecord[] } {
  if (!input || typeof input !== "object") {
    throw new Error("Unexpected AI response shape.");
  }

  const payload = input as { records?: unknown[]; skipped_records?: unknown[] };

  const records = Array.isArray(payload.records)
    ? payload.records
        .filter((item): item is ImportedCrmRecord => item !== null && typeof item === "object" && "source_row_index" in item)
        .map((record) => ({
          source_row_index: Number(record.source_row_index) || 0,
          created_at: normalizeCreatedAt(record.created_at),
          name: String(record.name ?? "").trim(),
          email: String(record.email ?? "").trim(),
          country_code: String(record.country_code ?? "").trim(),
          mobile_without_country_code: String(record.mobile_without_country_code ?? "").trim(),
          company: String(record.company ?? "").trim(),
          city: String(record.city ?? "").trim(),
          state: String(record.state ?? "").trim(),
          country: String(record.country ?? "").trim(),
          lead_owner: String(record.lead_owner ?? "").trim(),
          crm_status: String(record.crm_status ?? "").trim() as ImportedCrmRecord["crm_status"],
          crm_note: String(record.crm_note ?? "").trim(),
          data_source: String(record.data_source ?? "").trim() as ImportedCrmRecord["data_source"],
          possession_time: String(record.possession_time ?? "").trim(),
          description: String(record.description ?? "").trim()
        }))
    : [];

  const skippedRecords = Array.isArray(payload.skipped_records)
    ? payload.skipped_records
        .filter((item): item is SkippedRecord => Boolean(item) && typeof item === "object")
        .map((record) => ({
          source_row_index: Number((record as SkippedRecord).source_row_index) || 0,
          reason: String((record as SkippedRecord).reason ?? "Skipped by AI.")
        }))
    : [];

  return { records, skippedRecords };
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  return /rate limit|timeout|timed out|network|fetch|503|502|500|invalid json|json/i.test(error.message);
}

async function extractBatchWithAi(fileName: string, rows: CsvRow[], startIndex: number): Promise<{ records: ImportedCrmRecord[]; skippedRecords: SkippedRecord[] }> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return heuristicExtractRows(rows, fileName, startIndex);
  }

  const client = new OpenAI({ apiKey });
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAiRetries; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a precise CSV-to-CRM extraction engine.",
              "Map messy CSV layouts into GrowEasy CRM records.",
              "Only output JSON and never wrap it in markdown.",
              `Valid crm_status values: ${crmStatuses.join(", ")}.`,
              `Valid data_source values: ${crmDataSources.join(", ")}.`,
              "If the value is uncertain, leave optional fields blank instead of guessing."
            ].join(" ")
          },
          { role: "user", content: buildPrompt(fileName, rows, startIndex) }
        ]
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("AI response was empty.");
      }

      return sanitizeResult(parseJsonResponse(content));
    } catch (error) {
      lastError = error;

      if (attempt < maxAiRetries && isRetryableError(error)) {
        await delay(350 * attempt);
        continue;
      }

      break;
    }
  }

  if (lastError) {
    return heuristicExtractRows(rows, fileName, startIndex);
  }

  return heuristicExtractRows(rows, fileName, startIndex);
}

export async function extractCrmRecords(fileName: string, rows: CsvRow[]): Promise<ImportResponse> {
  const records: ImportedCrmRecord[] = [];
  const skippedRecords: SkippedRecord[] = [];
  const batches = chunkRows(rows, batchSize);

  for (const [batchIndex, batch] of batches.entries()) {
    const startIndex = batchIndex * batchSize + 1;
    const result = await extractBatchWithAi(fileName, batch, startIndex);
    records.push(...result.records);
    skippedRecords.push(...result.skippedRecords);
  }

  const validated = importResponseSchema.parse({
    fileName,
    totalRows: rows.length,
    importedCount: records.length,
    skippedCount: skippedRecords.length,
    records,
    skippedRecords,
    batchesProcessed: batches.length
  });

  return validated;
}