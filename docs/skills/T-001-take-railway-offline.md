# T-001 — Take Railway Offline & Secure Prototype

**Wave:** 1 — Foundation  
**Estimate:** 1 hour  
**Depends on:** Nothing  
**Blocks:** Nothing (do immediately)

---

## Context

The current prototype is deployed to a public Railway URL with no auth, no rate limiting, and Supabase credentials potentially exposed. This is a security and cost exposure risk that needs to be closed before any further work.

The view-builder will eventually live inside our main platform application, not as a standalone deployment. Until then, it should run locally only.

---

## Scope

Take the prototype offline and lock down credentials. This is purely a security/operations ticket — no feature work.

---

## Deliverables

1. Railway deployment is taken offline
2. Repo runs locally with no exposed credentials
3. README updated with local-only setup instructions
4. Brief plan written for how the view-builder will integrate into the main platform (this is a thinking/writing exercise, not code)

---

## Acceptance Criteria

- [ ] Railway deployment URL returns 404 or is deleted
- [ ] No `.env` file or any file with credentials is committed to the repo
- [ ] `.gitignore` includes `.env`, `.env.local`, and any other credential files
- [ ] If credentials were ever committed (check git history), they are rotated in Supabase and OpenRouter
- [ ] README explains how to run locally: clone, install, set up `.env.local`, run `npm run dev`
- [ ] A short markdown file (`docs/integration-plan.md`) describes how this app will integrate into the main platform — three options should be considered: (a) merge as a module in the main Next.js app, (b) embed via iframe, (c) run as an API service the platform calls. Pick one with a brief rationale.

---

## Notes for the Agent

- Don't refactor anything else while you're in here
- Don't add auth to the prototype — we're just taking it offline, not productionizing it
- The integration plan is a 1-page document, not a comprehensive spec — just enough to make the architectural direction clear
