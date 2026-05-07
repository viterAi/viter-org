# T-022 — Multi-Surface Renderer: WhatsApp + Email

**Wave:** 5 — Month 3+  
**Estimate:** 1.5 days  
**Depends on:** T-018 (MCP Apps build engine working)  
**Blocks:** Nothing (this is a delivery channel expansion)

---

## Context

The abstract spec format (T-003) makes views renderer-agnostic. T-018 added MCP Apps as a renderer (HTML bundles in iframes). This ticket adds two more renderers: WhatsApp (text + interactive buttons) and email (HTML email).

Same spec, different surface. A morning briefing can be a rich MCP App view in the platform, a text + buttons message on WhatsApp, and an HTML email in the user's inbox — all from one spec.

This unlocks the "surface mail" vision from earlier conversations.

---

## Scope

Build two new renderers: WhatsApp and Email. They consume the abstract spec and produce channel-appropriate output. Wire up sending logic for each. Pick one delivery scenario per channel and demo it end-to-end.

---

## Deliverables

1. WhatsApp renderer (`lib/renderers/whatsapp.ts`)
2. Email renderer (`lib/renderers/email.ts`)
3. Channel selection logic: given a spec + a channel, route to the right renderer
4. WhatsApp delivery: integration with WhatsApp Business API or similar
5. Email delivery: integration with Resend, SendGrid, or similar
6. Demo: a daily briefing spec rendered to all three channels (MCP App, WhatsApp, email)

---

## WhatsApp Renderer

WhatsApp supports:
- Text messages (with formatting: bold, italic, monospace)
- List messages (sectioned options the user can tap)
- Button messages (1-3 quick reply buttons)
- Templates (pre-approved message formats with parameters)

Mapping abstract spec → WhatsApp:

| Abstract Node | WhatsApp Equivalent |
|---------------|---------------------|
| `metric_strip` | Bold text with values: "*Total Outstanding:* $14,200" |
| `data_table` | List message with rows (top N items only — WhatsApp limits) |
| `single_item_focus` | Text with item details + button message for actions |
| `briefing_intro` | Text introducing the briefing |
| `completion_summary` | Text summarizing |
| `action_bar` | Button message (max 3 buttons) |
| `chart` | Skipped (or: "Chart available in app — open?") with deep link |

Constraints:
- Total characters per message: 1024 for body, 4096 for full message
- Max 10 list rows
- Max 3 buttons
- No images in this version (could add later)

---

## Email Renderer

Email supports rich HTML, so the renderer produces HTML that approximates the MCP App view but in email-safe HTML (table-based layouts, inline styles).

Mapping abstract spec → Email HTML:

| Abstract Node | Email Equivalent |
|---------------|------------------|
| `metric_strip` | Table row with cells styled as KPI cards |
| `data_table` | HTML table |
| `single_item_focus` | Card-styled div |
| `briefing_intro` | H1 + paragraph |
| `completion_summary` | Paragraph |
| `action_bar` | Buttons that link to the platform (deep links — clicking the button opens the platform with the action pre-filled) |
| `chart` | Pre-rendered PNG (use a chart library to generate, embed as inline image) |

Email actions are different from MCP App actions. The button doesn't fire a tool call directly; it opens a URL in the platform that triggers the action when the user authenticates and lands on the page. This is the "magic link" pattern.

---

## Channel Selection

```typescript
interface DeliveryRequest {
  spec: ViewSpec;
  channel: 'mcp_app' | 'whatsapp' | 'email' | 'murmur';
  recipient: User;
  context: DeliveryContext;
}

async function deliver(request: DeliveryRequest) {
  switch (request.channel) {
    case 'mcp_app': return renderAndSendMcpApp(request);
    case 'whatsapp': return renderAndSendWhatsApp(request);
    case 'email': return renderAndSendEmail(request);
    case 'murmur': return renderAndSendMurmur(request);
  }
}
```

Channel selection is driven by user preferences (per type of content) or explicit instruction ("send me this as a WhatsApp message").

---

## Demo Scenario

Build a "daily briefing" spec — a Briefing View summarizing what happened in the user's sources overnight. Render it to all three channels:

1. **MCP App in platform**: full rich view, interactive
2. **WhatsApp**: text summary + list of items + 3 buttons (View all, Snooze, Mark all reviewed)
3. **Email**: HTML email with the same content, deep links to the platform for actions

The user's preference dictates which channel(s) it goes to. Demo: send the same spec to all three at once and confirm the user receives it correctly in each.

---

## Acceptance Criteria

- [ ] WhatsApp renderer implemented and produces valid WhatsApp messages from spec
- [ ] Email renderer implemented and produces email-safe HTML from spec
- [ ] Channel selection logic routes specs to the right renderer
- [ ] WhatsApp delivery works (test with a real or sandbox WhatsApp Business API account)
- [ ] Email delivery works (using Resend or SendGrid sandbox)
- [ ] Demo scenario works: same daily briefing spec, three channels, content is appropriate for each
- [ ] Charts in emails render as PNG (using a chart library + image generation)
- [ ] Email buttons use magic links that route to the platform with actions pre-filled
- [ ] WhatsApp buttons trigger the platform via webhook (when user taps a button, our webhook receives it and acts)
- [ ] Documentation in `docs/multi-surface-rendering.md` explains how each renderer works and what's lost in translation per channel

---

## Notes for the Agent

- WhatsApp Business API requires approval and a phone number — for now, use a sandbox/test environment. Production setup is a separate concern.
- Email delivery: pick Resend (Next.js-friendly) or SendGrid. Both have free tiers.
- For the chart-as-PNG, consider using a service like QuickChart or a server-side chart library (Chart.js with node-canvas).
- The renderers don't need to be perfect at v1 — the goal is to prove the multi-surface architecture, not deliver a polished email designer.
- Each channel has constraints. Document what gets lost in translation: "WhatsApp can't show charts, so it links to the platform instead."
