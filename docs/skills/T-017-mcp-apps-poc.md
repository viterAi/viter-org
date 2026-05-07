# T-017 — MCP Apps Proof of Concept

**Wave:** 5 — Month 3+  
**Estimate:** 1 day  
**Depends on:** T-003, T-007  
**Blocks:** T-018, T-022

---

## Context

MCP Apps (`@modelcontextprotocol/ext-apps`) is the target delivery mechanism for views beyond Month 2. It's an open standard supported by Claude, ChatGPT, VS Code, Goose, and others. It gives us:

- Standardized embedding (sandboxed iframes)
- Bidirectional communication built into the protocol
- Cross-client distribution (same view works in multiple AI clients)
- Free shell — no need to build embedding infrastructure ourselves

This ticket validates that MCP Apps actually works for our use case before we commit to migrating the full system.

---

## Scope

Build a proof of concept: take ONE existing view (e.g., a spatial dashboard) and serve it as an MCP App. Test that it renders in Claude or ChatGPT. Verify bidirectional communication works.

---

## Deliverables

1. A standalone MCP server (`/mcp-poc/`) that exposes one view as an MCP App
2. The view renders in Claude Desktop or ChatGPT Desktop
3. Bidirectional communication verified: clicking an action in the view triggers a server tool, server pushes data update back to view
4. A short writeup (`docs/mcp-apps-poc-results.md`) covering: what worked, what didn't, recommended path forward

---

## Implementation

Follow the MCP Apps quickstart: github.com/modelcontextprotocol/ext-apps

```bash
mkdir mcp-poc && cd mcp-poc
npm init -y
npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/sdk express cors
npm install -D typescript vite vite-plugin-singlefile @types/express @types/cors @types/node tsx concurrently cross-env
```

The server registers a tool that returns view data and a UI resource that contains the HTML bundle:

```typescript
// server.ts (sketch)
import { registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({ name: "View Builder POC", version: "0.1.0" });
const resourceUri = "ui://view-poc/index.html";

registerAppTool(server, "show_invoices_dashboard", {
  title: "Show Invoices Dashboard",
  description: "Renders a dashboard of invoice data",
  inputSchema: { type: "object", properties: {} },
  _meta: { ui: { resourceUri } }
}, async () => {
  // fetch the data the view will render
  const data = await fetchInvoiceData();
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
});

registerAppResource(server, resourceUri, resourceUri, { mimeType: "text/html" }, async () => {
  const html = await fs.readFile("./dist/index.html", "utf-8");
  return { contents: [{ uri: resourceUri, mimeType: "text/html", text: html }] };
});
```

The HTML bundle uses the SDK to communicate back:

```typescript
// view code (sketch)
import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "View POC", version: "0.1.0" });

app.ontoolresult = (result) => {
  // received initial data — render the view
  const data = JSON.parse(result.content[0].text);
  renderDashboard(data);
};

async function handleAction(action, entity_id) {
  // user clicked an action button
  const result = await app.callServerTool({
    name: "update_invoice_status",
    arguments: { entity_id, action }
  });
  // server response triggers re-render
}

app.connect();
```

---

## Use Case to Build

Pick one of these (whichever has the cleanest existing view in the prototype):

**Option A: Static invoices dashboard**
- Data: a sample of invoice records (hardcoded or fetched from existing Supabase)
- View: KPI strip + data table
- Action: "Mark as Paid" button on each invoice — server updates the snapshot, pushes new data, view re-renders

**Option B: Static project board**
- Data: sample project records
- View: kanban-style with stages
- Action: Move card between stages — server updates, view re-renders

---

## Acceptance Criteria

- [ ] MCP server runs locally and exposes one view as an MCP App
- [ ] View HTML bundle is built (using vite-plugin-singlefile per quickstart)
- [ ] Server can be added to Claude Desktop's `mcp_servers` config
- [ ] Calling the tool from Claude renders the view in a sandboxed iframe in the conversation
- [ ] Action button in the view triggers a server tool call (verify with logs)
- [ ] Server response causes view to update with new data (no full page reload)
- [ ] Same setup works in ChatGPT Desktop (or document if it doesn't)
- [ ] Writeup in `docs/mcp-apps-poc-results.md` covers:
  - What worked
  - What didn't (or surprises)
  - Performance notes (latency, render time)
  - Recommendation: full migration, gradual migration, or stay custom

---

## Notes for the Agent

- This is a SEPARATE codebase from the main view-builder for now. Don't try to integrate it. The point is to validate the protocol.
- Use a static dataset — don't connect to real source APIs in this PoC.
- If you hit issues with the protocol or SDK, document them. They become input to the migration decision.
- Don't try to make this look beautiful. Functional > pretty for a PoC.
- Test in BOTH Claude Desktop and ChatGPT Desktop (or whichever clients are available). Cross-client compatibility is one of MCP Apps' main value props.
