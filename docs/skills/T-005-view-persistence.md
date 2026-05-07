# T-005 — View Persistence: Save / Load / Regenerate

**Wave:** 2 — Core Loop  
**Estimate:** 1 day  
**Depends on:** T-003  
**Blocks:** T-007, T-008

---

## Context

Right now, every time a user opens a view, the AI regenerates it from scratch. This is slow, inconsistent (same data may produce slightly different layouts), and burns tokens. It also means there's no way for a user to say "I like this view, keep it stable."

Views need a lifecycle:
1. AI generates a proposal
2. User steers/refines it
3. User saves it → spec is frozen
4. From now on, view loads the saved spec + fresh data (no AI call)
5. Steer modifications update the saved spec (with versioning)
6. "Regenerate from scratch" is an explicit, intentional action

---

## Scope

Implement view persistence in Supabase. Add save/load/regenerate flows. Implement versioning so users can roll back.

---

## Deliverables

1. Supabase schema migration: `views` table with spec storage, plus `view_versions` for history
2. API endpoints: save view, load view, list versions, rollback to version, regenerate
3. UI: "Save" button on a generated view, "Regenerate" action (explicit), version history panel
4. Loading flow: when a saved view is opened, load spec + fetch fresh data, no AI call

---

## Schema

```sql
-- views: the current state of each saved view
CREATE TABLE views (
  id UUID PRIMARY KEY,
  source_id UUID REFERENCES sources(id),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  spec JSONB NOT NULL,           -- the abstract spec from T-003
  is_default BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL,          -- 'draft' | 'saved' | 'archived'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- view_versions: every save creates a new version
CREATE TABLE view_versions (
  id UUID PRIMARY KEY,
  view_id UUID REFERENCES views(id),
  spec JSONB NOT NULL,           -- snapshot of spec at this version
  change_description TEXT,       -- e.g., "moved chart to top", "added filter"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);
```

---

## Behavior Spec

### Saving a view
- User generates a view (status='draft')
- User clicks Save
- View status changes to 'saved'
- A new entry is added to `view_versions`
- The view now loads from the saved spec on subsequent opens

### Loading a saved view
- User opens a saved view
- App fetches the view's spec from `views.spec`
- App fetches fresh data from the source connector
- Mapping layer (from T-003) renders the spec with the data
- NO AI generation call happens

### Regenerating
- User clicks "Regenerate from scratch"
- Confirmation dialog: "This will replace your current view layout. Are you sure?"
- AI generates a new spec
- User can compare to old version and choose to save or discard

### Steer modifications (when T-007 is done)
- User makes a Steer change
- New spec is computed
- View status stays 'saved' but `spec` is updated
- A new version entry is added to `view_versions`

### Version rollback
- User opens version history
- Sees list of versions with timestamps and change descriptions
- Clicks a version → preview
- Clicks "Restore" → that version's spec becomes the current one (and creates a new version entry recording the rollback)

---

## Acceptance Criteria

- [ ] Supabase migration applied: `views` and `view_versions` tables exist
- [ ] API endpoints implemented and tested:
  - [ ] `POST /api/views` — create or save a view
  - [ ] `GET /api/views/:id` — load a view's current spec
  - [ ] `GET /api/views/:id/versions` — list version history
  - [ ] `POST /api/views/:id/versions/:versionId/restore` — rollback
  - [ ] `POST /api/views/:id/regenerate` — explicit regeneration
- [ ] UI: "Save" button on draft views (becomes "Saved" with timestamp after click)
- [ ] UI: "Regenerate" action in a menu (with confirmation dialog)
- [ ] UI: Version history panel accessible from view settings
- [ ] Saved views load WITHOUT triggering AI generation (verify by checking logs)
- [ ] Fresh data fetched on every load (verify by changing source data and seeing it reflected)
- [ ] Each save creates a new entry in `view_versions`
- [ ] Rollback works: previewing a version then restoring it correctly updates the current spec

---

## Notes for the Agent

- Use Supabase Row Level Security: users can only see/modify their own views
- The spec is stored as JSONB — no need to flatten it
- Don't worry about diffing in the version history UI — just show "version N from [date]" with the change description. Diff visualization is a future enhancement.
- The "change description" is auto-generated for now: "Saved" for first save, "Updated via Steer" for Steer changes, "Manual edit" for direct spec edits, "Restored from version N" for rollbacks.
