/**
 * fetch-data tool — MCP data server connector (disabled until server is wired up).
 *
 * Interface:
 *   Input:  { question: string }  — a natural language question
 *   Output: { markdown: string }  — the data server's markdown-formatted answer
 *
 * Usage pattern (once enabled):
 *   const result = await fetchData({ question: "What are the overdue invoices?" });
 *   // result.markdown contains a markdown table / summary from the data server
 *
 * TODO: replace the stub body with an MCP tool call once the data server is connected.
 */

export type FetchDataInput = {
  question: string;
};

export type FetchDataResult = {
  markdown: string;
};

// Disabled — not yet connected.
// eslint-disable-next-line @typescript-eslint/require-await
export async function fetchData(_input: FetchDataInput): Promise<FetchDataResult | null> {
  return null;
}
