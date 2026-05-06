import type { SourceDataRow } from "../types/view-builder";

function coerceValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (!Number.isNaN(Number(trimmed)) && trimmed.match(/^-?\d+(\.\d+)?$/)) {
    return Number(trimmed);
  }
  return trimmed;
}

function parseMarkdownTable(markdown: string): SourceDataRow[] {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (lines.length < 3) return [];
  const header = lines[0]
    .slice(1, -1)
    .split("|")
    .map((part) => part.trim());

  const body = lines.slice(2);
  return body.map((line) => {
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((part) => part.trim());
    const row: SourceDataRow = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = coerceValue(cells[i] ?? "");
    }
    return row;
  });
}

function parseTranscriptMarkdown(markdown: string): SourceDataRow[] {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const transcriptRows: SourceDataRow[] = [];
  for (const line of lines) {
    const bulletMatch = line.match(/^- \[(.+?)\]\s*([^:]+):\s*(.+)$/);
    if (bulletMatch) {
      const [, timestamp, speaker, message] = bulletMatch;
      const extracted = {
        invoice_id:
          message.match(/invoice\s+([A-Z]+-\d+)/i)?.[1] ??
          message.match(/\b([A-Z]+-\d{3,})\b/)?.[1] ??
          null,
        client_name:
          message.match(/for\s+([a-z0-9_-]+)/i)?.[1] ??
          message.match(/\(([a-z0-9_-]+)\)/i)?.[1] ??
          null,
        status: message.match(/\b(current|due_1_30|due_31_60|due_61_plus)\b/i)?.[1] ?? null,
        follow_up_status:
          message.match(/\b(todo|in_progress|followed_up)\b/i)?.[1] ?? null,
        amount_cents: message.match(/amount=(\d+)/i)?.[1] ?? null,
      };

      transcriptRows.push({
        event_at: timestamp,
        speaker: speaker.trim(),
        message: message.trim(),
        invoice_id: extracted.invoice_id,
        client_name: extracted.client_name,
        status: extracted.status,
        follow_up_status: extracted.follow_up_status,
        amount_cents: coerceValue(String(extracted.amount_cents ?? "")),
      });
    }
  }
  return transcriptRows;
}

function parseCsv(csv: string): SourceDataRow[] {
  const lines = csv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((part) => part.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((part) => part.trim());
    const row: SourceDataRow = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = coerceValue(cells[i] ?? "");
    }
    return row;
  });
}

function parseJson(json: string): SourceDataRow[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed as SourceDataRow[];
}

export function parseSourceRows(input: {
  markdown: string;
  seedFormat: "markdown" | "json" | "csv";
}): SourceDataRow[] {
  if (!input.markdown.trim()) return [];
  if (input.seedFormat === "json") return parseJson(input.markdown);
  if (input.seedFormat === "csv") return parseCsv(input.markdown);
  const tableRows = parseMarkdownTable(input.markdown);
  if (tableRows.length > 0) return tableRows;
  return parseTranscriptMarkdown(input.markdown);
}
