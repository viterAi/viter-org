import type { SourceDataRow } from "../types/view-builder";

export type MockChat = {
  id: string;
  name: string;
  key: string;
  channel: "whatsapp";
};

export const MOCK_CHATS: MockChat[] = [
  { id: "client-updates", name: "Client Updates", key: "client-updates", channel: "whatsapp" },
  { id: "dev-team", name: "Dev Team", key: "dev-team", channel: "whatsapp" },
  { id: "sales-pipeline", name: "Sales Pipeline", key: "sales-pipeline", channel: "whatsapp" },
  { id: "support-channel", name: "Support Channel", key: "support-channel", channel: "whatsapp" },
  { id: "james-direct", name: "James Direct", key: "james-direct", channel: "whatsapp" },
  { id: "sarah-direct", name: "Sarah Direct", key: "sarah-direct", channel: "whatsapp" },
  { id: "product-team", name: "Product Team", key: "product-team", channel: "whatsapp" },
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

export function getMockChats(): MockChat[] {
  return MOCK_CHATS;
}

export function getMockMessages(chatId: string): SourceDataRow[] {
  return MOCK_MESSAGES[chatId] ?? [];
}
