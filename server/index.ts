import cors from "cors";
import express from "express";
import multer from "multer";
import { parseCsvBuffer, isRowEmpty } from "./lib/csv.js";
import { extractCrmRecords } from "./lib/extract.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",").map((item) => item.trim()) ?? true }));
app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/import", upload.single("file"), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: "Please upload a CSV file." });
      return;
    }

    if (!request.file.originalname.toLowerCase().endsWith(".csv")) {
      response.status(400).json({ error: "Only CSV files are supported." });
      return;
    }

    const parsed = parseCsvBuffer(request.file.buffer);
    const rows = parsed.rows.filter((row: Record<string, string>) => !isRowEmpty(row));

    if (rows.length === 0) {
      response.status(400).json({ error: "The uploaded CSV does not contain any data rows." });
      return;
    }

    const result = await extractCrmRecords(request.file.originalname, rows);
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    response.status(500).json({ error: message });
  }
});

app.use((_request, response) => {
  response.status(404).json({ error: "Route not found." });
});

app.listen(port, () => {
  console.log(`GrowEasy importer API listening on http://localhost:${port}`);
});