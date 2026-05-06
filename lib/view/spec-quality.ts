import { createHash } from "crypto";
import type { PersistedViewSpec, SourceDataRow } from "../types/view-builder";

const MAX_COLUMNS = 10;

export function computeSourceFingerprint(rows: SourceDataRow[]): string {
  const sample = rows.slice(0, 30).map((row) => {
    const sortedKeys = Object.keys(row).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of sortedKeys) normalized[key] = row[key];
    return normalized;
  });

  const payload = JSON.stringify({
    row_count: rows.length,
    sample,
  });

  return createHash("sha256").update(payload).digest("hex");
}

export function ensureSpecQuality(spec: PersistedViewSpec): PersistedViewSpec {
  const columns = spec.layout?.columns ?? [];
  if (columns.length === 0) {
    throw new Error("Generated spec must include at least one column.");
  }
  if (columns.length > MAX_COLUMNS) {
    throw new Error(`Generated spec has too many columns (>${MAX_COLUMNS}).`);
  }

  const seen = new Set<string>();
  for (const column of columns) {
    if (!column.field || !column.id || !column.label) {
      throw new Error("Each column must include id, field, and label.");
    }
    if (seen.has(column.id)) {
      throw new Error(`Duplicate column id '${column.id}' in generated spec.`);
    }
    seen.add(column.id);
  }

  if (!spec.layout.row_key) {
    throw new Error("Generated spec must include row_key.");
  }

  return spec;
}
