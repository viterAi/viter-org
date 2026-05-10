import type { SourceDataRow } from "../types/view-builder";

export type MockChat = {
  id: string;
  name: string;
  key: string;
  channel: string;
};

export const MOCK_CHATS: MockChat[] = [
  // WhatsApp
  { id: "client-updates", name: "Client Updates", key: "client-updates", channel: "whatsapp" },
  { id: "dev-team", name: "Dev Team", key: "dev-team", channel: "whatsapp" },
  { id: "sales-pipeline", name: "Sales Pipeline", key: "sales-pipeline", channel: "whatsapp" },
  { id: "support-channel", name: "Support Channel", key: "support-channel", channel: "whatsapp" },
  { id: "james-direct", name: "James Direct", key: "james-direct", channel: "whatsapp" },
  { id: "sarah-direct", name: "Sarah Direct", key: "sarah-direct", channel: "whatsapp" },
  { id: "product-team", name: "Product Team", key: "product-team", channel: "whatsapp" },
  // Slack
  { id: "slack-engineering", name: "#engineering", key: "slack-engineering", channel: "slack" },
  { id: "slack-general", name: "#general", key: "slack-general", channel: "slack" },
  { id: "slack-incidents", name: "#incidents", key: "slack-incidents", channel: "slack" },
  { id: "slack-deals", name: "#deals-won", key: "slack-deals", channel: "slack" },
  // Email
  { id: "email-apex-thread", name: "Apex Industries — Proposal", key: "email-apex-thread", channel: "email" },
  { id: "email-bluepeak-onboarding", name: "Bluepeak Onboarding", key: "email-bluepeak-onboarding", channel: "email" },
  { id: "email-investor-update", name: "Investor Update — May", key: "email-investor-update", channel: "email" },
  // Gmail
  { id: "gmail-support-inbox", name: "Support Inbox", key: "gmail-support-inbox", channel: "gmail" },
  // Monday.com
  { id: "monday-q2-roadmap", name: "Q2 Roadmap Board", key: "monday-q2-roadmap", channel: "monday_com" },
  { id: "monday-client-onboarding", name: "Client Onboarding", key: "monday-client-onboarding", channel: "monday_com" },
  // Notion
  { id: "notion-weekly-sync", name: "Weekly Sync Notes", key: "notion-weekly-sync", channel: "notion" },
  // LinkedIn
  { id: "linkedin-outreach", name: "LinkedIn Outreach", key: "linkedin-outreach", channel: "linkedin" },
];

const MOCK_MESSAGES: Record<string, SourceDataRow[]> = {
  "client-updates": [
    { sender: "Alex Chen", message: "Just got off a call with Meridian Corp — they want to expand the contract to 3 more offices by Q3.", timestamp: "2026-05-01T09:12:00Z", kind: "text" },
    { sender: "Rachel Torres", message: "That's great news! Did they mention budget?", timestamp: "2026-05-01T09:14:00Z", kind: "text" },
    { sender: "Alex Chen", message: "Around 180k. Still needs sign-off from their CFO.", timestamp: "2026-05-01T09:15:00Z", kind: "text" },
    { sender: "James Wright", message: "Bluepeak just raised a concern about the onboarding timeline. They're worried we can't hit June 15th.", timestamp: "2026-05-01T10:30:00Z", kind: "text" },
    { sender: "Rachel Torres", message: "June 15th is tight but doable if we start the data migration next week.", timestamp: "2026-05-01T10:33:00Z", kind: "text" },
    { sender: "James Wright", message: "I'll send them a revised project plan today to reassure them.", timestamp: "2026-05-01T10:35:00Z", kind: "text" },
    { sender: "Alex Chen", message: "Orion Labs is asking for a demo next Thursday. They specifically want to see the reporting module.", timestamp: "2026-05-02T08:45:00Z", kind: "text" },
    { sender: "Sarah Kim", message: "I can prep that. Any specific metrics they care about?", timestamp: "2026-05-02T08:50:00Z", kind: "text" },
    { sender: "Alex Chen", message: "Revenue by region and team utilisation. They run distributed teams across 4 time zones.", timestamp: "2026-05-02T08:52:00Z", kind: "text" },
    { sender: "Rachel Torres", message: "Update: Meridian CFO approved. Contract is going to legal tomorrow.", timestamp: "2026-05-02T16:20:00Z", kind: "text" },
    { sender: "James Wright", message: "Sent the revised plan to Bluepeak. They confirmed they're happy to proceed.", timestamp: "2026-05-03T11:10:00Z", kind: "text" },
    { sender: "Sarah Kim", message: "Demo prep done for Orion. Slides are in the shared folder.", timestamp: "2026-05-04T09:00:00Z", kind: "text" },
    { sender: "Alex Chen", message: "Stellar Group hasn't responded to the proposal we sent 2 weeks ago. Worth a follow-up?", timestamp: "2026-05-04T14:30:00Z", kind: "text" },
    { sender: "Rachel Torres", message: "Yes — I'll call them this afternoon. Last time they said procurement was backed up.", timestamp: "2026-05-04T14:35:00Z", kind: "text" },
    { sender: "James Wright", message: "Bluepeak migration kicked off. All 3 environments set up. Day 1 went smoothly.", timestamp: "2026-05-05T18:00:00Z", kind: "text" },
    { sender: "Alex Chen", message: "Orion demo went really well. They want a commercial proposal by EOW.", timestamp: "2026-05-06T15:45:00Z", kind: "text" },
    { sender: "Sarah Kim", message: "Brilliant! What tier are they looking at?", timestamp: "2026-05-06T15:48:00Z", kind: "text" },
    { sender: "Alex Chen", message: "Mid-tier, 50 seats. Potential to grow to 200 by year end if they roll out to all regions.", timestamp: "2026-05-06T15:50:00Z", kind: "text" },
    { sender: "Rachel Torres", message: "Stellar Group got back — they want a meeting on the 14th. Budget approved on their end.", timestamp: "2026-05-06T17:00:00Z", kind: "text" },
    { sender: "James Wright", message: "Bluepeak day 3 — minor issue with SSO integration, working with their IT team to fix.", timestamp: "2026-05-07T09:30:00Z", kind: "text" },
    { sender: "Alex Chen", message: "Good progress everyone. Orion proposal is priority this week.", timestamp: "2026-05-07T10:00:00Z", kind: "text" },
  ],

  "dev-team": [
    { sender: "Nina Patel", message: "Sprint 14 planning: main focus is the data pipeline refactor and the new export module.", timestamp: "2026-05-01T09:00:00Z", kind: "text" },
    { sender: "Marcus Lee", message: "I'll take the pipeline refactor. Should be done by Wednesday if the schema changes are signed off.", timestamp: "2026-05-01T09:05:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "Export module is mostly done. Just need to handle edge cases for large CSV exports.", timestamp: "2026-05-01T09:08:00Z", kind: "text" },
    { sender: "Nina Patel", message: "PRD: the column remapping bug is still open — priority P1 since it's blocking 3 clients.", timestamp: "2026-05-01T09:10:00Z", kind: "text" },
    { sender: "Marcus Lee", message: "I can look at that after standup. Probably a 2-hour fix.", timestamp: "2026-05-01T09:12:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "Also heads up — staging is down. Deployment failed at 2am, rolling back now.", timestamp: "2026-05-01T09:15:00Z", kind: "text" },
    { sender: "Nina Patel", message: "Staging is back up. The rollback completed. Root cause was a missing env variable in the deploy config.", timestamp: "2026-05-01T10:45:00Z", kind: "text" },
    { sender: "Marcus Lee", message: "Column remapping bug fixed and deployed to staging. Can someone QA?", timestamp: "2026-05-01T14:00:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "QA done — looks good. Ready to go to prod.", timestamp: "2026-05-01T15:30:00Z", kind: "text" },
    { sender: "Nina Patel", message: "Deployed to prod. Notifying the affected clients.", timestamp: "2026-05-01T16:00:00Z", kind: "text" },
    { sender: "Marcus Lee", message: "Schema changes approved. Starting pipeline refactor now.", timestamp: "2026-05-02T09:30:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "Export module PR up for review. Large CSV edge case now handled with chunked streaming.", timestamp: "2026-05-03T11:00:00Z", kind: "text" },
    { sender: "Nina Patel", message: "Review done — merging export module. Nice work Tom.", timestamp: "2026-05-03T14:00:00Z", kind: "text" },
    { sender: "Marcus Lee", message: "Pipeline refactor done. Tests passing. PR up.", timestamp: "2026-05-04T17:00:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "Reviewed the pipeline PR — one comment about error handling on the retry logic but otherwise good.", timestamp: "2026-05-05T09:00:00Z", kind: "text" },
    { sender: "Marcus Lee", message: "Updated. Retry logic now has exponential backoff with a cap at 3 attempts.", timestamp: "2026-05-05T11:00:00Z", kind: "text" },
    { sender: "Nina Patel", message: "Merging. Sprint 14 is looking good. Next sprint we need to tackle the permissions model rewrite.", timestamp: "2026-05-05T14:00:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "New bug report from Bluepeak — SSO integration is failing for users in their EU region.", timestamp: "2026-05-07T09:15:00Z", kind: "text" },
    { sender: "Marcus Lee", message: "Looking into it now. Might be the SAML assertion TTL — EU region has different clock sync.", timestamp: "2026-05-07T09:20:00Z", kind: "text" },
    { sender: "Nina Patel", message: "Good call — fix ASAP. Bluepeak is a priority account.", timestamp: "2026-05-07T09:25:00Z", kind: "text" },
    { sender: "Marcus Lee", message: "Fix deployed to staging. Testing now before pushing to prod.", timestamp: "2026-05-07T11:30:00Z", kind: "text" },
  ],

  "sales-pipeline": [
    { sender: "Carlos Ruiz", message: "Pipeline update for the week: 4 deals in negotiation, 2 in proposal stage, 1 closed.", timestamp: "2026-05-01T08:30:00Z", kind: "text" },
    { sender: "Emma Walsh", message: "The closed deal — that's Pinnacle Financial right? Great work Carlos.", timestamp: "2026-05-01T08:35:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Yes! 80k ARR. They signed yesterday. 12-month contract with an option to expand.", timestamp: "2026-05-01T08:37:00Z", kind: "text" },
    { sender: "Liam Novak", message: "I have a call with Delta Logistics tomorrow. They're at the pricing stage — think we can close this week.", timestamp: "2026-05-01T09:00:00Z", kind: "text" },
    { sender: "Emma Walsh", message: "What's the deal size on Delta?", timestamp: "2026-05-01T09:02:00Z", kind: "text" },
    { sender: "Liam Novak", message: "Around 65k. They want a 2-year deal with a 10% discount. I'm holding at 7%.", timestamp: "2026-05-01T09:04:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Apex Industries meeting today — they came in asking about our enterprise tier. Potential 200k deal.", timestamp: "2026-05-02T14:00:00Z", kind: "text" },
    { sender: "Emma Walsh", message: "200k would be huge. Is this a real procurement cycle or just exploring?", timestamp: "2026-05-02T14:05:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Real cycle — they have a Q3 budget. But there are 2 other vendors in the running.", timestamp: "2026-05-02T14:07:00Z", kind: "text" },
    { sender: "Liam Novak", message: "Delta Logistics closed! 65k, 2-year deal at 7% discount. Contracts signed this morning.", timestamp: "2026-05-03T10:00:00Z", kind: "text" },
    { sender: "Emma Walsh", message: "Amazing! That's 2 closes this week.", timestamp: "2026-05-03T10:02:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Apex meeting went well. They want a technical deep-dive with their engineering team next week.", timestamp: "2026-05-03T17:00:00Z", kind: "text" },
    { sender: "Emma Walsh", message: "I have 3 demos lined up this week. Horizon Tech, CloudBase, and a referral from Pinnacle.", timestamp: "2026-05-04T08:00:00Z", kind: "text" },
    { sender: "Liam Novak", message: "Referral from a client is always warm — who's the contact?", timestamp: "2026-05-04T08:05:00Z", kind: "text" },
    { sender: "Emma Walsh", message: "CFO of Vertex Solutions. Pinnacle's CEO introduced us last week.", timestamp: "2026-05-04T08:07:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Horizon Tech demo went really well. They want a proposal by Friday.", timestamp: "2026-05-06T16:00:00Z", kind: "text" },
    { sender: "Emma Walsh", message: "Vertex Solutions call done — they're interested. Sending over a proposal next week.", timestamp: "2026-05-06T17:30:00Z", kind: "text" },
    { sender: "Liam Novak", message: "Month is tracking at 145k closed, 265k in pipeline. Good position for Q2.", timestamp: "2026-05-07T08:00:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Apex technical deep-dive scheduled for Tuesday. Need to make sure the engineering team is prepped.", timestamp: "2026-05-07T09:00:00Z", kind: "text" },
  ],

  "support-channel": [
    { sender: "Priya Sharma", message: "Ticket #4821 — Bluepeak reporting incorrect totals on the revenue dashboard. Investigating now.", timestamp: "2026-05-01T09:30:00Z", kind: "text" },
    { sender: "Daniel Foster", message: "I saw that one come in. Might be related to the timezone issue we had last month.", timestamp: "2026-05-01T09:35:00Z", kind: "text" },
    { sender: "Priya Sharma", message: "Confirmed — UTC offset issue. Data is correct, the display was wrong. Fix deployed.", timestamp: "2026-05-01T11:00:00Z", kind: "text" },
    { sender: "Daniel Foster", message: "New ticket #4822 — Orion Labs can't export data to Excel. Getting an error on large files.", timestamp: "2026-05-02T10:00:00Z", kind: "text" },
    { sender: "Priya Sharma", message: "This is the CSV chunking bug Tom was working on. Should be fixed in today's deploy.", timestamp: "2026-05-02T10:05:00Z", kind: "text" },
    { sender: "Daniel Foster", message: "#4822 resolved after the deploy. Orion confirmed working.", timestamp: "2026-05-02T16:30:00Z", kind: "text" },
    { sender: "Priya Sharma", message: "CSAT scores for April: 4.6/5. Response time average 2.3 hours. Both up from March.", timestamp: "2026-05-03T09:00:00Z", kind: "text" },
    { sender: "Daniel Foster", message: "Good numbers. The backlog is down to 12 open tickets, all low priority.", timestamp: "2026-05-03T09:05:00Z", kind: "text" },
    { sender: "Priya Sharma", message: "Ticket #4830 — Meridian Corp asking about custom SSO configuration. This is a pro-tier feature, routing to sales.", timestamp: "2026-05-04T13:00:00Z", kind: "text" },
    { sender: "Daniel Foster", message: "New ticket #4831 — Delta Logistics onboarding question about user roles. Responding now.", timestamp: "2026-05-05T10:00:00Z", kind: "text" },
    { sender: "Priya Sharma", message: "#4831 resolved. Also updated the onboarding docs to clarify role permissions.", timestamp: "2026-05-05T11:30:00Z", kind: "text" },
    { sender: "Daniel Foster", message: "Ticket #4835 — Bluepeak SSO broken for EU users. P1. Escalating to dev.", timestamp: "2026-05-07T09:00:00Z", kind: "text" },
    { sender: "Priya Sharma", message: "Acknowledged. I've also called their IT contact directly to let them know we're on it.", timestamp: "2026-05-07T09:10:00Z", kind: "text" },
    { sender: "Daniel Foster", message: "Dev has a fix on staging. ETA to prod: 1 hour.", timestamp: "2026-05-07T11:35:00Z", kind: "text" },
    { sender: "Priya Sharma", message: "Updated Bluepeak. They're standing by to test once it's live.", timestamp: "2026-05-07T11:40:00Z", kind: "text" },
  ],

  "james-direct": [
    { sender: "James Wright", message: "Hey — can you take a look at the Bluepeak contract before I send it? Just want a second set of eyes.", timestamp: "2026-05-01T08:00:00Z", kind: "text" },
    { sender: "You", message: "Sure, send it over.", timestamp: "2026-05-01T08:05:00Z", kind: "text" },
    { sender: "James Wright", message: "Sent. Main thing I'm unsure about is section 4.2 — the SLA terms.", timestamp: "2026-05-01T08:07:00Z", kind: "text" },
    { sender: "You", message: "4.2 looks fine to me. 99.5% uptime is standard. I'd just double-check the penalty clause in 4.3.", timestamp: "2026-05-01T08:30:00Z", kind: "text" },
    { sender: "James Wright", message: "Good catch — 4.3 had a typo in the penalty calculation. Fixed.", timestamp: "2026-05-01T08:45:00Z", kind: "text" },
    { sender: "James Wright", message: "Quick one — the Bluepeak migration is going well but their IT team is slow on the SSO setup. Any escalation path?", timestamp: "2026-05-06T14:00:00Z", kind: "text" },
    { sender: "You", message: "Talk to Priya in support — she has the direct contact for their IT manager.", timestamp: "2026-05-06T14:10:00Z", kind: "text" },
    { sender: "James Wright", message: "Done. Priya was helpful. SSO should be sorted by tomorrow.", timestamp: "2026-05-06T16:00:00Z", kind: "text" },
  ],

  "sarah-direct": [
    { sender: "Sarah Kim", message: "The Orion demo prep is done. Do you want to review the slide deck before Thursday?", timestamp: "2026-05-04T09:30:00Z", kind: "text" },
    { sender: "You", message: "Yes please — send it over today if you can.", timestamp: "2026-05-04T09:35:00Z", kind: "text" },
    { sender: "Sarah Kim", message: "Shared. Let me know if the revenue by region slide needs more detail.", timestamp: "2026-05-04T10:00:00Z", kind: "text" },
    { sender: "You", message: "Looks great. One thing — can we add a slide on team utilisation benchmarks? They specifically asked about that.", timestamp: "2026-05-04T11:00:00Z", kind: "text" },
    { sender: "Sarah Kim", message: "Added. Updated deck is in the same folder.", timestamp: "2026-05-04T12:30:00Z", kind: "text" },
    { sender: "Sarah Kim", message: "Orion went really well! They asked a lot of questions about the API — I think their engineering team is interested in building on top of it.", timestamp: "2026-05-06T15:00:00Z", kind: "text" },
    { sender: "You", message: "That's a good sign. Make sure to mention it in the proposal — API access is part of the enterprise tier.", timestamp: "2026-05-06T15:15:00Z", kind: "text" },
  ],

  "product-team": [
    { sender: "Maya Johnson", message: "Q2 roadmap final review today. Main tracks: permissions rewrite, AI reporting features, mobile app.", timestamp: "2026-05-01T10:00:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "Permissions rewrite is on the dev backlog — estimated 3 sprints.", timestamp: "2026-05-01T10:05:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Sales is getting frequent requests for better mobile access. Any movement on the mobile app?", timestamp: "2026-05-01T10:08:00Z", kind: "text" },
    { sender: "Maya Johnson", message: "Mobile app is Q3. We need the API stabilised first. Q2 focus is the reporting AI features.", timestamp: "2026-05-01T10:10:00Z", kind: "text" },
    { sender: "Nina Patel", message: "AI reporting — what's the MVP? Auto-generated summaries or anomaly detection?", timestamp: "2026-05-01T10:12:00Z", kind: "text" },
    { sender: "Maya Johnson", message: "MVP is auto-generated weekly summaries. Anomaly detection is phase 2.", timestamp: "2026-05-01T10:14:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "Weekly summaries could reuse the export module I just shipped. Should be fast to build.", timestamp: "2026-05-01T10:16:00Z", kind: "text" },
    { sender: "Maya Johnson", message: "User research results are in. Top 3 pain points: slow report loading, no mobile access, confusing permission settings.", timestamp: "2026-05-03T14:00:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Slow report loading — that matches what clients tell me. Any idea on root cause?", timestamp: "2026-05-03T14:05:00Z", kind: "text" },
    { sender: "Nina Patel", message: "It's the query layer — no caching on complex reports. Marcus is planning to fix this in the pipeline refactor.", timestamp: "2026-05-03T14:08:00Z", kind: "text" },
    { sender: "Maya Johnson", message: "Good. Let's make sure report loading improvement is a KPI for the pipeline refactor.", timestamp: "2026-05-03T14:10:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "AI summary feature spec ready for review. Building on top of the export module as planned.", timestamp: "2026-05-05T15:00:00Z", kind: "text" },
    { sender: "Maya Johnson", message: "Reviewed — looks solid. One question: how do we handle clients with insufficient data for a meaningful summary?", timestamp: "2026-05-05T16:30:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "Good point — adding a minimum data threshold check. If < 10 data points, show a 'not enough data' state.", timestamp: "2026-05-05T17:00:00Z", kind: "text" },
    { sender: "Nina Patel", message: "Pipeline refactor shipped. Report loading is now 4x faster on complex queries. Tested with Bluepeak's dataset.", timestamp: "2026-05-06T14:00:00Z", kind: "text" },
    { sender: "Maya Johnson", message: "4x faster is great. Updating the Q2 KPI dashboard.", timestamp: "2026-05-06T14:10:00Z", kind: "text" },
    { sender: "Carlos Ruiz", message: "Apex Industries are going to ask about the AI features in their technical deep-dive Tuesday. Can we show a demo?", timestamp: "2026-05-07T09:00:00Z", kind: "text" },
    { sender: "Tom Okafor", message: "AI summaries are in early dev but I can put together a prototype for Tuesday.", timestamp: "2026-05-07T09:10:00Z", kind: "text" },
    { sender: "Maya Johnson", message: "Yes — let's do it. Mark it as 'beta preview' so there are no expectation issues.", timestamp: "2026-05-07T09:15:00Z", kind: "text" },
  ],
};

const MOCK_MESSAGES_EXTRA: Record<string, SourceDataRow[]> = {
  "slack-engineering": [
    { sender: "marcus.lee", message: "Deployed pipeline refactor to prod. Watching metrics — looks clean.", timestamp: "2026-05-05T14:10:00Z", kind: "text" },
    { sender: "tom.okafor", message: "Nice. P99 latency on the reports endpoint dropped from 4.2s to 0.9s. 🎉", timestamp: "2026-05-05T14:15:00Z", kind: "text" },
    { sender: "nina.patel", message: "Incredible. That's going to make a huge difference for clients with large datasets.", timestamp: "2026-05-05T14:18:00Z", kind: "text" },
    { sender: "marcus.lee", message: "Error rate is 0.01% — within normal. Looks like a clean ship.", timestamp: "2026-05-05T14:25:00Z", kind: "text" },
    { sender: "tom.okafor", message: "Bluepeak SSO issue — root cause confirmed. SAML assertion TTL mismatch in EU region. Fix is a 3-line config change.", timestamp: "2026-05-07T09:20:00Z", kind: "text" },
    { sender: "nina.patel", message: "How did this get through QA? Do we not test EU config in CI?", timestamp: "2026-05-07T09:22:00Z", kind: "text" },
    { sender: "tom.okafor", message: "We don't — adding EU region to CI matrix is on the list now.", timestamp: "2026-05-07T09:24:00Z", kind: "text" },
    { sender: "marcus.lee", message: "Fix staged, running smoke tests. Will push to prod in ~30 mins.", timestamp: "2026-05-07T11:00:00Z", kind: "text" },
    { sender: "nina.patel", message: "Give a shout when it's live — support needs to verify with Bluepeak.", timestamp: "2026-05-07T11:05:00Z", kind: "text" },
    { sender: "marcus.lee", message: "Live. Bluepeak should be able to log in now.", timestamp: "2026-05-07T11:45:00Z", kind: "text" },
    { sender: "tom.okafor", message: "Confirmed working from Bluepeak's side. Incident closed.", timestamp: "2026-05-07T12:10:00Z", kind: "text" },
  ],

  "slack-general": [
    { sender: "maya.johnson", message: "All-hands recording is in Notion if you missed it. Main topics: Q2 roadmap, hiring plan, and the Apex deal.", timestamp: "2026-05-05T10:00:00Z", kind: "text" },
    { sender: "carlos.ruiz", message: "Delta Logistics and Pinnacle Financial both closed this week! 🎊 Great work everyone.", timestamp: "2026-05-03T10:05:00Z", kind: "text" },
    { sender: "priya.sharma", message: "Support CSAT hit 4.6 in April — highest ever. Team has been amazing.", timestamp: "2026-05-03T10:10:00Z", kind: "text" },
    { sender: "nina.patel", message: "New joiners this week: Aisha (frontend) and Rohan (data). Welcome! 👋", timestamp: "2026-05-04T09:00:00Z", kind: "text" },
    { sender: "maya.johnson", message: "Reminder: Q2 OKR check-in is Thursday at 3pm. Please update your key results before then.", timestamp: "2026-05-06T09:00:00Z", kind: "text" },
    { sender: "carlos.ruiz", message: "Orion demo today went really well. Expecting a proposal request by EOW.", timestamp: "2026-05-06T16:00:00Z", kind: "text" },
    { sender: "tom.okafor", message: "AI summary feature is in dev — prototype will be ready for the Apex demo Tuesday.", timestamp: "2026-05-07T09:30:00Z", kind: "text" },
  ],

  "slack-incidents": [
    { sender: "tom.okafor", message: "🔴 INC-041 OPEN — Staging deploy failed. Rolling back. ETA 20 mins.", timestamp: "2026-05-01T02:05:00Z", kind: "text" },
    { sender: "tom.okafor", message: "✅ INC-041 RESOLVED — Rollback complete. Root cause: missing env var in deploy config. Post-mortem tomorrow.", timestamp: "2026-05-01T02:28:00Z", kind: "text" },
    { sender: "marcus.lee", message: "🔴 INC-042 OPEN — Bluepeak SSO broken for EU users. P1. Investigating.", timestamp: "2026-05-07T09:00:00Z", kind: "text" },
    { sender: "marcus.lee", message: "INC-042 — Root cause: SAML TTL mismatch. Fix staged.", timestamp: "2026-05-07T11:00:00Z", kind: "text" },
    { sender: "marcus.lee", message: "✅ INC-042 RESOLVED — Fix live. Bluepeak confirmed. Post-mortem: add EU region to CI.", timestamp: "2026-05-07T12:15:00Z", kind: "text" },
  ],

  "slack-deals": [
    { sender: "carlos.ruiz", message: "🎉 Pinnacle Financial CLOSED — 80k ARR, 12 months. Signed yesterday!", timestamp: "2026-05-01T08:40:00Z", kind: "text" },
    { sender: "liam.novak", message: "🎉 Delta Logistics CLOSED — 65k ARR, 2 years. Just got the signature!", timestamp: "2026-05-03T10:00:00Z", kind: "text" },
    { sender: "maya.johnson", message: "That's 145k ARR in one week! Amazing start to May. 🚀", timestamp: "2026-05-03T10:03:00Z", kind: "text" },
    { sender: "emma.walsh", message: "Orion Labs demo went really well today. Commercial proposal going out by Friday — potential 50 seats.", timestamp: "2026-05-06T16:30:00Z", kind: "text" },
    { sender: "carlos.ruiz", message: "Apex Industries technical deep-dive confirmed for Tuesday. 200k deal in play.", timestamp: "2026-05-07T09:05:00Z", kind: "text" },
    { sender: "liam.novak", message: "Pipeline is at 265k for the month — Q2 is looking strong.", timestamp: "2026-05-07T08:05:00Z", kind: "text" },
  ],

  "email-apex-thread": [
    { sender: "carlos.ruiz@company.com", message: "Hi David, great to meet you and the team today. As discussed, I'm sending over our enterprise tier proposal. Key highlights: unlimited seats, dedicated CSM, 99.9% SLA, and full API access. Total: $198,000/year. Happy to jump on a call to walk through it.", timestamp: "2026-05-02T17:00:00Z", kind: "email" },
    { sender: "david.marsh@apex.com", message: "Thanks Carlos. The team was impressed with the demo. A few questions before we progress: 1) Can you support SSO via Okta? 2) What's your data residency policy for EU data? 3) Can the contract be structured quarterly?", timestamp: "2026-05-03T10:30:00Z", kind: "email" },
    { sender: "carlos.ruiz@company.com", message: "Hi David, answers: 1) Yes, Okta SSO is fully supported — we have several enterprise clients on it already. 2) EU data stays in EU-West-1 (Ireland). 3) Quarterly is fine — we can structure 4x $49,500 invoices. Let me know if this works and we can get legal aligned.", timestamp: "2026-05-03T14:00:00Z", kind: "email" },
    { sender: "david.marsh@apex.com", message: "Good. Engineering team deep-dive confirmed for Tuesday May 12th at 2pm GMT. Please bring your technical lead. They'll want to review the API docs and security architecture.", timestamp: "2026-05-04T09:00:00Z", kind: "email" },
    { sender: "carlos.ruiz@company.com", message: "Confirmed for Tuesday. I'll bring Nina (CTO) and Marcus (lead engineer). Sharing our API docs and security whitepaper in advance.", timestamp: "2026-05-04T10:00:00Z", kind: "email" },
    { sender: "david.marsh@apex.com", message: "Received the docs. One more question — do you support custom webhooks for real-time data sync? Our ops team uses a home-built dashboard and would want to pipe data out.", timestamp: "2026-05-06T11:00:00Z", kind: "email" },
    { sender: "carlos.ruiz@company.com", message: "Yes — webhooks are part of the enterprise tier. You can configure up to 20 endpoints with filtering by event type. Marcus can demo this on Tuesday.", timestamp: "2026-05-06T13:00:00Z", kind: "email" },
  ],

  "email-bluepeak-onboarding": [
    { sender: "james.wright@company.com", message: "Hi Bluepeak team, welcome! Attached is the onboarding plan for your 3-office rollout. Week 1: environments setup. Week 2: data migration. Week 3: user training. Week 4: go-live.", timestamp: "2026-04-28T09:00:00Z", kind: "email" },
    { sender: "helen.ford@bluepeak.com", message: "Thanks James. One question — our EU office uses different identity providers. Will the SSO setup handle this?", timestamp: "2026-04-28T11:00:00Z", kind: "email" },
    { sender: "james.wright@company.com", message: "Yes — we support multiple IdPs per organisation. Marcus from our engineering team will handle the SSO config personally for your EU office.", timestamp: "2026-04-28T13:00:00Z", kind: "email" },
    { sender: "helen.ford@bluepeak.com", message: "Great. Week 1 environments are confirmed. We're ready to start data migration Monday.", timestamp: "2026-05-02T16:00:00Z", kind: "email" },
    { sender: "james.wright@company.com", message: "Migration kicked off — all 3 environments live. Day 1 metrics look healthy.", timestamp: "2026-05-05T18:30:00Z", kind: "email" },
    { sender: "helen.ford@bluepeak.com", message: "URGENT — EU office users cannot log in via SSO. This is blocking 40 people from working. Please advise.", timestamp: "2026-05-07T08:50:00Z", kind: "email" },
    { sender: "james.wright@company.com", message: "Helen — acknowledged. Our engineering team is on it as priority 1. ETA: 1-2 hours. Priya from support has your IT manager's number and will keep you updated.", timestamp: "2026-05-07T09:05:00Z", kind: "email" },
    { sender: "james.wright@company.com", message: "Fix deployed. EU SSO is now working. Please confirm your team can log in and let me know if anything else needs attention.", timestamp: "2026-05-07T12:00:00Z", kind: "email" },
    { sender: "helen.ford@bluepeak.com", message: "Confirmed — all EU users can log in. Thank you for the fast response. Happy to continue with week 3 training as planned.", timestamp: "2026-05-07T12:30:00Z", kind: "email" },
  ],

  "email-investor-update": [
    { sender: "maya.johnson@company.com", message: "Subject: May Investor Update\n\nHi all,\n\nMay highlights:\n• 2 new enterprise contracts closed (Pinnacle 80k, Delta Logistics 65k)\n• Pipeline: 265k active, including Apex Industries (200k) and Orion Labs (50k)\n• Team: 2 new hires (frontend + data eng)\n• Product: pipeline refactor shipped — 4x faster report loading\n• Support CSAT: 4.6/5 (all-time high)\n\nQ2 is tracking ahead of plan. Full metrics in the attached dashboard.\n\nMaya", timestamp: "2026-05-07T08:00:00Z", kind: "email" },
    { sender: "rachel.green@vcfirm.com", message: "Great update Maya. The Apex deal would be transformative if it closes. What's your confidence level and timeline?", timestamp: "2026-05-07T09:30:00Z", kind: "email" },
    { sender: "maya.johnson@company.com", message: "Hi Rachel, confidence is high — 70%+. They're in active procurement, budget is confirmed, and the technical deep-dive is Tuesday. If it goes well I'd expect a decision by end of May.", timestamp: "2026-05-07T10:00:00Z", kind: "email" },
    { sender: "david.kim@angels.com", message: "Impressive CSAT score. What's driving it — team size increase or process changes?", timestamp: "2026-05-07T10:30:00Z", kind: "email" },
    { sender: "maya.johnson@company.com", message: "Both — we added Daniel to support in March, and Priya restructured the triage process. Average response time went from 4.1h to 2.3h.", timestamp: "2026-05-07T11:00:00Z", kind: "email" },
  ],

  "gmail-support-inbox": [
    { sender: "contact@orionlabs.com", message: "Hi, following up on ticket #4822. The Excel export issue is resolved — thank you! One more question: is there a way to schedule automatic exports daily?", timestamp: "2026-05-03T09:00:00Z", kind: "email" },
    { sender: "priya.sharma@company.com", message: "Hi Orion team, glad the export is working! Scheduled exports are on our roadmap for Q3. In the meantime, you can use our API with a cron job on your end. Happy to share a code snippet.", timestamp: "2026-05-03T10:00:00Z", kind: "email" },
    { sender: "it@bluepeak.com", message: "Ticket #4835 follow-up: SSO is confirmed working for all EU users. Your response time on this was excellent — less than 3 hours from report to resolution.", timestamp: "2026-05-07T13:00:00Z", kind: "email" },
    { sender: "accounts@meridian-corp.com", message: "Please find attached PO #MC-2026-089 for the expanded contract. Legal will send the signed agreement by COB today.", timestamp: "2026-05-02T14:00:00Z", kind: "email" },
    { sender: "john.smith@stellargroup.com", message: "Hi, we reviewed your proposal from 3 weeks ago. Budget has been approved. Could we schedule a meeting on May 14th to discuss next steps?", timestamp: "2026-05-06T16:45:00Z", kind: "email" },
  ],

  "monday-q2-roadmap": [
    { task_id: "T-001", task_name: "Permissions Rewrite", status: "in_progress", owner: "Nina Patel", due_date: "2026-06-30", priority: "high", completion_pct: 30, sprint: 15, notes: "3 sprints estimated, started sprint 15" },
    { task_id: "T-002", task_name: "AI Weekly Summaries", status: "in_progress", owner: "Tom Okafor", due_date: "2026-06-15", priority: "high", completion_pct: 55, sprint: 15, notes: "MVP scoped, prototype ready for Apex demo May 12" },
    { task_id: "T-003", task_name: "Export Module", status: "done", owner: "Tom Okafor", due_date: "2026-05-03", priority: "medium", completion_pct: 100, sprint: 14, notes: "Large CSV chunking handled, deployed to prod" },
    { task_id: "T-004", task_name: "Pipeline Refactor", status: "done", owner: "Marcus Lee", due_date: "2026-05-05", priority: "high", completion_pct: 100, sprint: 14, notes: "4x perf improvement, P99 latency 0.9s" },
    { task_id: "T-005", task_name: "Mobile App", status: "planned", owner: "TBD", due_date: "2026-09-30", priority: "low", completion_pct: 0, sprint: null, notes: "Blocked on API stabilisation" },
    { task_id: "T-006", task_name: "EU Region CI Coverage", status: "to_do", owner: "Marcus Lee", due_date: "2026-05-20", priority: "high", completion_pct: 0, sprint: 15, notes: "Added after INC-042 post-mortem" },
    { task_id: "T-007", task_name: "Anomaly Detection", status: "planned", owner: "Tom Okafor", due_date: "2026-09-30", priority: "medium", completion_pct: 0, sprint: null, notes: "Phase 2 after AI summaries ship" },
    { task_id: "T-008", task_name: "API Webhook Enhancements", status: "in_progress", owner: "Marcus Lee", due_date: "2026-05-31", priority: "high", completion_pct: 40, sprint: 15, notes: "Apex deal dependency — enterprise tier feature" },
  ],

  "monday-client-onboarding": [
    { client_id: "C-001", client_name: "Bluepeak Financial", onboarding_status: "training", health: "at_risk", onboarding_week: 3, go_live_date: "2026-06-01", csm: "James Wright", completion_pct: 65, notes: "SSO incident resolved, on track for go-live June 1" },
    { client_id: "C-002", client_name: "Delta Logistics", onboarding_status: "setup", health: "healthy", onboarding_week: 1, go_live_date: "2026-06-15", csm: "James Wright", completion_pct: 15, notes: "New contract, environments being provisioned" },
    { client_id: "C-003", client_name: "Meridian Corp", onboarding_status: "active", health: "healthy", onboarding_week: 8, go_live_date: "2026-03-10", csm: "Rachel Torres", completion_pct: 100, notes: "Contract expansion signed, 3 new offices added to scope" },
    { client_id: "C-004", client_name: "Pinnacle Financial", onboarding_status: "active", health: "healthy", onboarding_week: 12, go_live_date: "2026-02-14", csm: "James Wright", completion_pct: 100, notes: "Fully live, requesting API access for internal reporting" },
    { client_id: "C-005", client_name: "Orion Labs", onboarding_status: "pre_sales", health: "at_risk", onboarding_week: 0, go_live_date: null, csm: "Priya Sharma", completion_pct: 0, notes: "Demo done, proposal stage, awaiting commercial sign-off" },
  ],

  "notion-weekly-sync": [
    { sender: "maya.johnson", message: "## Week of May 5 — Key Decisions\n- Apex technical deep-dive confirmed for May 12. Nina + Marcus attending.\n- AI summaries prototype to be ready by May 11 for the demo.\n- EU CI coverage added to sprint 15 backlog after Bluepeak incident.", timestamp: "2026-05-05T17:00:00Z", kind: "note" },
    { sender: "nina.patel", message: "## Engineering Update\nPipeline refactor shipped — 4x faster queries. Bluepeak SSO incident resolved in <3h. Next focus: permissions rewrite (sprint 15) and EU CI coverage.", timestamp: "2026-05-05T17:05:00Z", kind: "note" },
    { sender: "carlos.ruiz", message: "## Sales Update\n145k ARR closed in week 1 of May. Apex (200k) and Orion (50k) are the big ones in play. Both have strong signals.", timestamp: "2026-05-05T17:10:00Z", kind: "note" },
    { sender: "priya.sharma", message: "## Support Update\nClosed 18 tickets this week. Bluepeak SSO was the only P1 — handled in under 3 hours. Backlog is at 6 open tickets, all low priority.", timestamp: "2026-05-05T17:15:00Z", kind: "note" },
    { sender: "maya.johnson", message: "## Action Items\n- [ ] Carlos: Apex prep for May 12\n- [ ] Tom: AI summaries prototype by May 11\n- [ ] Marcus: EU CI matrix added to sprint 15\n- [ ] James: Bluepeak week 3 training schedule\n- [ ] All: Q2 OKR update by Thursday", timestamp: "2026-05-05T17:20:00Z", kind: "note" },
  ],

  "linkedin-outreach": [
    { sender: "emma.walsh", message: "Sent connection request to VP Operations at CloudBase Systems. Noted their recent Series B — good timing for enterprise tooling conversation.", timestamp: "2026-05-01T10:00:00Z", kind: "message" },
    { sender: "emma.walsh", message: "CloudBase VP accepted. Sent intro message: 'Hi Mark, congrats on the Series B — exciting growth ahead. We work with a few fast-scaling ops teams and thought there might be a fit. Happy to share how we've helped similar companies. 15 mins this week?'", timestamp: "2026-05-02T09:00:00Z", kind: "message" },
    { sender: "emma.walsh", message: "Reply from CloudBase Mark: 'Thanks Emma. We're actually evaluating tools in this space right now. Can do Thursday at 11am.'", timestamp: "2026-05-03T14:00:00Z", kind: "message" },
    { sender: "liam.novak", message: "Reached out to 12 prospects from the FinTech 50 list. 3 have responded so far. All expressing interest in the reporting angle.", timestamp: "2026-05-04T11:00:00Z", kind: "message" },
    { sender: "emma.walsh", message: "CloudBase call done — very interested. They have a team of 80 and are drowning in spreadsheets. Sending proposal next week.", timestamp: "2026-05-06T11:30:00Z", kind: "message" },
    { sender: "liam.novak", message: "FinTech 50 follow-ups: 2 converted to discovery calls booked for next week. 1 not interested.", timestamp: "2026-05-07T09:00:00Z", kind: "message" },
    { sender: "emma.walsh", message: "New warm intro from Pinnacle Financial CEO to their CFO network — 3 contacts. Will reach out this week.", timestamp: "2026-05-07T10:00:00Z", kind: "message" },
  ],
};

const ALL_MOCK_MESSAGES = { ...MOCK_MESSAGES, ...MOCK_MESSAGES_EXTRA };

export function getMockChats(): MockChat[] {
  return MOCK_CHATS;
}

export function getMockMessages(chatId: string): SourceDataRow[] {
  return ALL_MOCK_MESSAGES[chatId] ?? [];
}
