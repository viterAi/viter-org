# T-018 — Build Engine Produces MCP Apps HTML Bundles

**Wave:** 5 — Month 3+  
**Estimate:** 1.5 days  
**Depends on:** T-017  
**Blocks:** T-022 (multi-surface)

---

## Context

T-017 proved MCP Apps works for our use case. Now we migrate the build engine: instead of rendering components directly in the host app, the build engine produces self-contained HTML bundles that are served by an MCP server and rendered as MCP Apps.

This is the architectural shift from "platform with embedded components" to "platform as MCP Apps host."

---

## Scope

Update the build engine to produce MCP Apps HTML bundles from the abstract spec. Build the MCP server that serves them. Implement the platform as an MCP Apps host. Migrate at least one view-type (Spatial) end-to-end.

---

## Deliverables

1. Build engine update: takes abstract spec → produces HTML bundle compatible with MCP Apps
2. MCP server (`apps/mcp-server/`) that registers tools for each saved view and serves the bundles
3. Platform updated to be an MCP Apps host: views render via iframe using the protocol
4. Action write-back works through `app.callServerTool()`
5. At least one existing view migrated and working end-to-end

---

## Architecture After This Ticket

```
Platform (Next.js app)
  ├── Surface layer (renders MCP App iframes)
  └── Dock layer (chats with agents)

MCP Server (separate process or co-located)
  ├── Tools: one per saved view (show_dashboard_X, show_triage_Y)
  ├── Tools: actions (update_invoice_status, etc.)
  └── Resources: HTML bundles served at ui:// URIs

Build Engine
  └── Produces HTML bundles from abstract specs

Spec storage (Supabase)
  └── Views table — specs used by build engine to produce bundles
```

When a user opens a view in the platform:
1. Platform looks up the view's MCP tool
2. Platform (acting as MCP host) calls the tool
3. MCP server returns data + HTML resource URI
4. Platform fetches the HTML and renders in an iframe
5. UI in the iframe communicates back via `app.callServerTool()`

---

## Build Engine Changes

The build engine now produces:

1. An HTML file that contains the view's UI code, bundled into a single file (using `vite-plugin-singlefile` like the MCP Apps quickstart)
2. Embedded JS that imports the MCP Apps SDK and connects to the host
3. Spec-aware rendering: the HTML knows how to render each LayoutNode type from the abstract spec

The bundle is stored as a static asset (or generated on demand from the spec — pick one based on caching strategy).

---

## MCP Server

Standalone MCP server that:

1. Reads the views from Supabase
2. For each saved view, registers a tool: `show_view_<view_id>` with metadata pointing to the HTML bundle
3. Registers action tools: `execute_action_<action_id>` for any actions defined in saved view specs
4. Serves the HTML bundles as resources

Run it as either a separate Node process or co-located with the platform. Either way, the platform connects to it as an MCP host.

---

## Platform as MCP Apps Host

The platform needs to:

1. Implement the MCP Apps host protocol (use `@modelcontextprotocol/ext-apps/app-bridge` or roll your own per the spec)
2. Render iframes for active views
3. Handle the message-passing between iframes and the MCP server
4. Pass auth context to the MCP server when calling tools

---

## Acceptance Criteria

- [ ] Build engine produces HTML bundles from abstract specs
- [ ] Bundles are valid MCP Apps (SDK connects, communication works)
- [ ] MCP server runs and registers tools for all saved views
- [ ] Platform renders MCP App views in iframes on the surface layer
- [ ] Auth context passes to MCP server: server knows which user is requesting which view
- [ ] Action write-back works: clicking an action in an iframe triggers the corresponding server tool, server processes it, view updates
- [ ] At least one existing view (a spatial dashboard) is migrated and working in the new architecture
- [ ] Old custom rendering is removed for migrated view types (don't keep two systems running)
- [ ] Performance is acceptable: view loads in under 2 seconds (measure and report actual numbers)

---

## Notes for the Agent

- This is a major architectural change. Plan carefully before coding.
- Run T-017 (the PoC) results before starting — if the PoC surfaced issues, address them in the design here.
- Don't migrate ALL views at once. Spatial first; Sequential later.
- The MCP server is a backend service. It doesn't need a UI of its own.
- Keep the data layer in Supabase. The MCP server reads from Supabase and serves bundles; it doesn't have its own database.
- Caching: bundle HTML can be cached aggressively (it only changes when the spec changes). Data is fresh on every tool call.
