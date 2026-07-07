import type { CsvRow } from "./csv.js";
import type { CrmDataSource, CrmRecord, CrmStatus, ImportedCrmRecord, SkippedRecord } from "../../shared/crm.js";
import { ensureText, normalizeCreatedAt, normalizeCrmStatus, normalizeDataSource } from "../../shared/crm.js";

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const mobileRegex = /(?:\+?\d{1,3}[\s-]?)?(?:\d[\s-]?){7,14}\d/g;

const fieldAliases: Record<keyof CrmRecord, string[]> = {
  created_at: ["created_at", "created at", "date", "created date", "lead created", "timestamp"],
  name: ["name", "full name", "customer name", "lead name", "contact name"],
  email: ["email", "email address", "primary email", "e-mail"],
  country_code: ["country_code", "country code", "cc", "dial code", "country dial code"],
  mobile_without_country_code: ["mobile_without_country_code", "mobile", "phone", "phone number", "contact number", "whatsapp"],
  company: ["company", "company name", "organisation", "organization", "business", "brand"],
  city: ["city", "town", "location city"],
  state: ["state", "province", "region"],
  country: ["country", "nation"],
  lead_owner: ["lead_owner", "lead owner", "owner", "assigned to", "sales owner"],
  crm_status: ["crm_status", "status", "lead status", "stage"],
  crm_note: ["crm_note", "note", "notes", "remarks", "comment", "comments", "description", "additional info"],
  data_source: ["data_source", "source", "lead source", "origin"],
  possession_time: ["possession_time", "possession", "possession timeline", "possession date"],
  description: ["description", "details", "message", "additional description"]
};

function findColumnValue(row: CsvRow, aliases: string[]): string {
  const entries = Object.entries(row);

  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase();

    const match = entries.find(([key]) => key.toLowerCase().trim() === normalizedAlias || key.toLowerCase().includes(normalizedAlias));
    if (match) {
      return ensureText(match[1]);
    }
  }

  return "";
}

function collectMatches(value: string, regex: RegExp): string[] {
  return value.match(regex)?.map((item) => item.trim()) ?? [];
}

function inferStatus(value: string): CrmStatus {
  const lowered = value.toLowerCase();

  if (/sale|closed won|payment received|deal won|booking done/.test(lowered)) {
    return "SALE_DONE";
  }

  if (/not interested|bad lead|wrong number|spam|invalid|duplicate/.test(lowered)) {
    return "BAD_LEAD";
  }

  if (/did not connect|not connected|busy|no answer|unreachable|callback/.test(lowered)) {
    return "DID_NOT_CONNECT";
  }

  if (/follow up|call back|reschedule|interested|enquiry|demo/.test(lowered)) {
    return "GOOD_LEAD_FOLLOW_UP";
  }

  return "";
}

function inferDataSource(row: CsvRow, fileName: string, description: string): CrmDataSource {
  const haystack = `${fileName} ${Object.values(row).join(" ")} ${description}`.toLowerCase();

  if (haystack.includes("leads on demand") || haystack.includes("lod")) {
    return "leads_on_demand";
  }
  if (haystack.includes("meridian")) {
    return "meridian_tower";
  }
  if (haystack.includes("eden park") || haystack.includes("edenpark")) {
    return "eden_park";
  }
  if (haystack.includes("varah") || haystack.includes("swamy")) {
    return "varah_swamy";
  }
  if (haystack.includes("sarjapur")) {
    return "sarjapur_plots";
  }

  return normalizeDataSource(findColumnValue(row, fieldAliases.data_source));
}

function buildNote(row: CsvRow, extras: string[]): string {
  const parts = [ensureText(findColumnValue(row, fieldAliases.crm_note)), ...extras].map((value) => value.trim()).filter(Boolean);
  return parts.join(" | ");
}

function normalizeMobile(value: string): { countryCode: string; mobile: string } {
  const compact = value.replace(/[^\d+]/g, "").trim();

  if (!compact) {
    return { countryCode: "", mobile: "" };
  }

  if (compact.startsWith("+")) {
    const digits = compact.slice(1);
    const countryCode = `+${digits.slice(0, Math.min(3, Math.max(1, digits.length - 10)))}`;
    return {
      countryCode,
      mobile: digits.slice(countryCode.length - 1)
    };
  }

  return { countryCode: "", mobile: compact };
}

export function heuristicExtractRows(rows: CsvRow[], fileName: string, startIndex: number): {
  records: ImportedCrmRecord[];
  skippedRecords: SkippedRecord[];
} {
  const records: ImportedCrmRecord[] = [];
  const skippedRecords: SkippedRecord[] = [];

  for (const [offset, row] of rows.entries()) {
    const sourceRowIndex = startIndex + offset;
    const combinedText = Object.values(row).join(" ");

    const emailCandidates = collectMatches(combinedText, emailRegex);
    const mobileCandidates = collectMatches(combinedText, mobileRegex).filter((candidate) => candidate.replace(/\D/g, "").length >= 7);

    const email = ensureText(findColumnValue(row, fieldAliases.email)) || emailCandidates[0] || "";
    const mobileSource = ensureText(findColumnValue(row, fieldAliases.mobile_without_country_code)) || mobileCandidates[0] || "";

    if (!email && !mobileSource) {
      skippedRecords.push({ source_row_index: sourceRowIndex, reason: "Skipped because the record does not contain an email or mobile number." });
      continue;
    }

    const additionalEmails = emailCandidates.slice(email ? 1 : 0);
    const additionalMobiles = mobileCandidates.slice(mobileSource ? 1 : 0);
    const fullName = ensureText(findColumnValue(row, fieldAliases.name));
    const description = ensureText(findColumnValue(row, fieldAliases.description));
    const statusCandidate = inferStatus(`${findColumnValue(row, fieldAliases.crm_status)} ${combinedText}`);
    const source = inferDataSource(row, fileName, description);
    const mobileParts = normalizeMobile(mobileSource);

    const crmNote = buildNote(row, [
      additionalEmails.length > 0 ? `Additional emails: ${additionalEmails.join(", ")}` : "",
      additionalMobiles.length > 0 ? `Additional mobile numbers: ${additionalMobiles.join(", ")}` : ""
    ]);

    records.push({
      source_row_index: sourceRowIndex,
      created_at: normalizeCreatedAt(findColumnValue(row, fieldAliases.created_at)),
      name: fullName,
      email,
      country_code: ensureText(findColumnValue(row, fieldAliases.country_code)) || mobileParts.countryCode,
      mobile_without_country_code: mobileParts.mobile,
      company: ensureText(findColumnValue(row, fieldAliases.company)),
      city: ensureText(findColumnValue(row, fieldAliases.city)),
      state: ensureText(findColumnValue(row, fieldAliases.state)),
      country: ensureText(findColumnValue(row, fieldAliases.country)),
      lead_owner: ensureText(findColumnValue(row, fieldAliases.lead_owner)),
      crm_status: normalizeCrmStatus(findColumnValue(row, fieldAliases.crm_status)) || statusCandidate,
      crm_note: crmNote,
      data_source: source,
      possession_time: ensureText(findColumnValue(row, fieldAliases.possession_time)),
      description
    });
  }

  return { records, skippedRecords };
}