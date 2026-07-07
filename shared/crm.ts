import { z } from "zod";

export const crmStatuses = ["GOOD_LEAD_FOLLOW_UP", "DID_NOT_CONNECT", "BAD_LEAD", "SALE_DONE"] as const;
export const crmDataSources = ["leads_on_demand", "meridian_tower", "eden_park", "varah_swamy", "sarjapur_plots"] as const;

export const crmRecordSchema = z.object({
  created_at: z.string().optional().default(""),
  name: z.string().optional().default(""),
  email: z.string().optional().default(""),
  country_code: z.string().optional().default(""),
  mobile_without_country_code: z.string().optional().default(""),
  company: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  country: z.string().optional().default(""),
  lead_owner: z.string().optional().default(""),
  crm_status: z.enum(crmStatuses).or(z.literal("")).optional().default(""),
  crm_note: z.string().optional().default(""),
  data_source: z.enum(crmDataSources).or(z.literal("")).optional().default(""),
  possession_time: z.string().optional().default(""),
  description: z.string().optional().default("")
});

export const importedCrmRecordSchema = crmRecordSchema.extend({
  source_row_index: z.number().int().nonnegative()
});

export const skippedRecordSchema = z.object({
  source_row_index: z.number().int().nonnegative(),
  reason: z.string()
});

export const importResponseSchema = z.object({
  fileName: z.string(),
  totalRows: z.number().int().nonnegative(),
  importedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  records: z.array(importedCrmRecordSchema),
  skippedRecords: z.array(skippedRecordSchema),
  batchesProcessed: z.number().int().nonnegative()
});

export type CrmStatus = (typeof crmStatuses)[number] | "";
export type CrmDataSource = (typeof crmDataSources)[number] | "";
export type CrmRecord = z.infer<typeof crmRecordSchema>;
export type ImportedCrmRecord = z.infer<typeof importedCrmRecordSchema>;
export type SkippedRecord = z.infer<typeof skippedRecordSchema>;
export type ImportResponse = z.infer<typeof importResponseSchema>;

export function normalizeValue(value: unknown): string {
  if (typeof value !== "string") {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value).trim();
  }

  return value.trim();
}

export function normalizeCrmStatus(value: unknown): CrmStatus {
  const upperValue = normalizeValue(value).toUpperCase();

  if ((crmStatuses as readonly string[]).includes(upperValue)) {
    return upperValue as CrmStatus;
  }

  if (!upperValue) {
    return "";
  }

  const compact = upperValue.replace(/[^A-Z]/g, "");
  const candidates: Record<string, CrmStatus> = {
    GOODLEADFOLLOWUP: "GOOD_LEAD_FOLLOW_UP",
    FOLLOWUP: "GOOD_LEAD_FOLLOW_UP",
    CONNECTED: "GOOD_LEAD_FOLLOW_UP",
    DIDNOTCONNECT: "DID_NOT_CONNECT",
    NOTCONNECTED: "DID_NOT_CONNECT",
    BADLEAD: "BAD_LEAD",
    NOTINTERESTED: "BAD_LEAD",
    SALEDONE: "SALE_DONE",
    CLOSEDWON: "SALE_DONE"
  };

  return candidates[compact] ?? "";
}

export function normalizeDataSource(value: unknown): CrmDataSource {
  const normalized = normalizeValue(value).toLowerCase();

  if ((crmDataSources as readonly string[]).includes(normalized)) {
    return normalized as CrmDataSource;
  }

  return "";
}

export function ensureText(value: unknown): string {
  return normalizeValue(value);
}

export function normalizeCreatedAt(value: unknown): string {
  const text = normalizeValue(value);

  if (!text) {
    return "";
  }

  const candidates = [text, text.replace(/\//g, "-"), text.replace(" ", "T")];

  for (const candidate of candidates) {
    const parsedDate = new Date(candidate);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }

  return "";
}
