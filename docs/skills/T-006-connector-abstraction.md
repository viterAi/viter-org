# T-006 — Connector Abstraction Interface

**Wave:** 2 — Core Loop  
**Estimate:** 1 day  
**Depends on:** T-003  
**Blocks:** T-013, real source integrations (Xero, Plunet, etc.)

---

## Context

Right now, "actions" in a view write back to our local Supabase column (which holds the source data as a snapshot). This is fine for prototyping but doesn't deliver the real promise: when a user clicks "Mark as Paid" on an invoice, that action should travel to Xero's API and update the invoice in Xero — not just our local cache.

We're not building the Xero connector in this ticket. We're designing the abstraction so that when we build connectors, they plug in cleanly without rewriting the action system.

---

## Scope

Design a connector interface. Implement a default "local snapshot" connector that wraps current behavior. Update action specs to reference connectors. Document the interface so future connectors can be added.

---

## Deliverables

1. Connector interface definition (`lib/connectors/types.ts`)
2. Action spec format updated to include connector reference
3. Default `LocalConnector` implementation (wraps current Supabase write-back behavior)
4. Connector registry (`lib/connectors/registry.ts`)
5. Documentation: `docs/connector-interface.md` with a worked example of how to add a new connector

---

## The Connector Interface

```typescript
interface Connector {
  // Identifier, e.g., "xero", "plunet", "local"
  name: string;
  
  // Read data from the source
  read(query: ReadQuery): Promise<ReadResult>;
  
  // Write back an action result
  write(action: ActionRequest): Promise<ActionResult>;
  
  // Subscribe to changes (webhook, polling, etc.)
  subscribe?(filter: SubscriptionFilter, callback: ChangeCallback): Subscription;
  
  // Capabilities — what this connector supports
  capabilities: {
    can_read: boolean;
    can_write: boolean;
    can_subscribe: boolean;
    supported_actions: string[];  // e.g., ["update_status", "delete", "create"]
  };
}
```

### Action Request Format

```typescript
interface ActionRequest {
  action: string;          // e.g., "update_status"
  entity_type: string;     // e.g., "invoice"
  entity_id: string;
  payload: Record<string, any>;  // e.g., { status: "PAID" }
  user_id: string;         // who initiated
  metadata: {
    source_view_id?: string;
    timestamp: string;
  };
}
```

### Action Spec Format (in views)

The spec format from T-003 needs to specify which connector handles each action. Update the action spec:

```typescript
interface ActionDefinition {
  id: string;
  label: string;            // user-facing
  connector: string;        // which connector handles this
  action: string;           // which action on that connector
  entity_binding: string;   // expression that resolves to the entity
  payload_template: Record<string, any>;
  confirmation?: {
    required: boolean;
    message: string;
  };
}
```

Example:
```json
{
  "id": "mark-paid",
  "label": "Mark as Paid",
  "connector": "xero",
  "action": "update_status",
  "entity_binding": "invoices.{row.id}",
  "payload_template": { "status": "PAID" },
  "confirmation": {
    "required": false,
    "message": ""
  }
}
```

---

## The LocalConnector

This wraps the current behavior so existing functionality doesn't break:

- `read()` — fetches from the source's stored markdown/JSON in Supabase
- `write()` — updates the stored snapshot (current behavior)
- `subscribe()` — polls the local data for changes
- Used as the default connector for any source that doesn't have a real integration yet

---

## Acceptance Criteria

- [ ] Connector interface (`Connector`, `ActionRequest`, `ReadQuery`, etc.) defined in TypeScript
- [ ] `ConnectorRegistry` exists — connectors are registered by name and looked up at action time
- [ ] `LocalConnector` implemented and registered as the default
- [ ] Spec format from T-003 updated to include `connector` field on action definitions
- [ ] AI generation prompt updated to produce action specs with connector references
- [ ] Mapping layer routes actions through the registered connector (not directly to Supabase)
- [ ] Existing actions still work (LocalConnector handles them)
- [ ] `docs/connector-interface.md` includes:
  - The interface in full
  - A walkthrough of how the LocalConnector implements it
  - A skeleton example of what a future XeroConnector would look like (pseudocode is fine)
- [ ] Tests: at minimum, a unit test that confirms an action with `connector: "local"` routes to LocalConnector

---

## Notes for the Agent

- Don't build the Xero/Plunet/etc. connectors. Just the interface and the local default.
- Don't add webhook handling logic in this ticket — `subscribe()` is in the interface but the LocalConnector can just poll on a timer.
- The ActionRequest format should be flexible enough that connectors can extend it with connector-specific fields if needed (e.g., Xero might need a tenant ID). Use a `connector_metadata` field for that.
- This is a design ticket as much as a code ticket. Spend half the time thinking about whether the interface holds up before implementing.
