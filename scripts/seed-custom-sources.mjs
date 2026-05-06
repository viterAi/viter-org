import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env");
const envFile = readFileSync(envPath, "utf8");
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, "");
  if (!process.env[key]) process.env[key] = value;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const sources = [
  {
    key: "space_chat_v1",
    name: "Space Exploration Chat",
    channel: "whatsapp",
    description: "Late-night conversation about space, missions, and habitability.",
    markdown: `# Late-night thinking out loud about space

I keep coming back to one thing. We talk about Mars like it is the obvious next step, but the more I read about radiation on the surface and the thinness of the atmosphere, the more I wonder if we are picking that destination because it photographs well and not because it is actually the best place to go.

The moon feels boring to people because we already went there, but it is genuinely close, the comms latency is small, and we can build infrastructure that is reusable for everything else. If we cannot keep someone alive on the moon for two years without a resupply, we have no business pretending we are going to do it on Mars.

There is also this idea I cannot shake about Venus. The surface is hostile in every way you can imagine, but if you go up about fifty kilometers the pressure is roughly Earth-like and the temperature is reasonable. Floating habitats sound like science fiction until you read the actual numbers. The numbers are not crazy, the engineering is.

What bothers me about the current public conversation is that it is mostly framed as a race. Race against who. Race for what. The interesting questions are not who plants the next flag. They are: how do you grow food without sunlight you can rely on, how do you handle psychological isolation for crews of six over twenty months, how do you decide whose laws apply when something goes wrong off-world.

I do not think we have an answer for any of that yet. We have engineers who can solve the physics problems. We do not have institutions that can solve the human problems.

Anyway. I started this thinking about rockets and ended up thinking about loneliness. Probably says something.`,
    seed_format: "markdown",
  },
  {
    key: "kitchen_call_v1",
    name: "Kitchen Phone Call Transcript",
    channel: "email",
    description: "Recorded call with mom about a recipe gone wrong.",
    markdown: `# Phone call with mom about the bread

Mom asked why my sourdough came out flat again. I told her I think the starter is fine but I am not folding enough during the first rise. She laughed at me and said I am being too gentle with it. She kept saying the dough is not a baby, you have to push it around or it will not develop any structure.

She told me about the kitchen she grew up cooking in. There was no thermometer, no scale, no timer. Her mother judged everything by smell and by how the dough sounded when you pressed it. I asked her if she could teach me that and she said no, you cannot teach it, you have to ruin enough loaves until your hands learn it.

I told her I bought a banneton and she laughed even harder. She said her mother used a kitchen towel inside a wooden bowl her entire life and never lost a single loaf. I do not know if that is true or if it is one of those stories that gets better every year.

We ended up talking for almost an hour. She told me about a fight she had with her sister in nineteen eighty something that I had never heard about. I do not even know how we got there from sourdough.

I am going to try again tomorrow. Higher hydration, more aggressive folds, longer cold proof in the fridge. If it fails I will not tell her.`,
    seed_format: "markdown",
  },
  {
    key: "history_debate_v1",
    name: "History Class Argument",
    channel: "portal",
    description: "Long-form discussion notes from a heated history seminar.",
    markdown: `# Notes from the seminar that turned into an argument

The professor said something at the start that I think most of us missed in the moment. He said history is not the study of what happened. It is the study of what got remembered, by whom, and why. The whole rest of the seminar people were arguing about facts and dates and he was clearly trying to get us off that.

There was a long thread about whether the Industrial Revolution was a good thing. The economists in the room were saying yes, look at infant mortality, look at calorie intake, look at literacy. The humanities students were saying you cannot reduce a transformation that uprooted entire ways of life into a graph that goes up and to the right.

I think they were both right and both missing each other. Numbers do not capture what it feels like to lose your village. Stories do not capture how many children would have died in a previous century.

There was a moment where someone said that history is written by the victors and the professor stopped them and said that is wrong, actually. He said history is mostly written by bureaucrats. The victors do not have time. The defeated are not allowed to. It is the people who do paperwork who shape the record.

That stuck with me more than anything else from the whole semester. Most of what we know about the Roman Empire comes from tax receipts and inventories. Not battle reports. Not poetry. Receipts.

I am going to think about that the next time I am annoyed about filling out a form.`,
    seed_format: "markdown",
  },
  {
    key: "music_chat_v1",
    name: "Music Recommendations Thread",
    channel: "whatsapp",
    description: "WhatsApp-style back and forth about an album that broke someone's heart.",
    markdown: `# Conversation about that one album

I asked her what she had been listening to and she said nothing for two weeks. I thought she meant she was busy. She meant she could not put music on without crying.

She told me she had finally listened to a record that an ex had recommended to her years ago and never wanted to play while they were together because it felt too important to share. After the breakup she could not bring herself to listen to it. She said this week she finally did and it was even better than he had said.

She was not crying because of him. She was crying because she had spent years protecting herself from a piece of art that turned out to be exactly what she needed.

I asked which album. She would not tell me. She said if she said the name out loud it would stop being hers and start being a recommendation, and she did not want it to become a recommendation yet.

We talked for a while about that idea. About how some songs are private even after they go platinum. About how a melody can stay yours even when fifty million other people have the same one in their headphones. About how the version of a song that lives in your head after you have not heard it in five years is not really the song anymore. It is a memory of a feeling you had once.

I have been thinking about that all day. I am not sure I have ever loved anything that quietly.`,
    seed_format: "markdown",
  },
  {
    key: "philosophy_chat_v1",
    name: "Late Night Philosophy",
    channel: "whatsapp",
    description: "Free-form thinking about identity and memory.",
    markdown: `# Three in the morning thinking again

I keep getting stuck on the ship of Theseus, but in a way that is not philosophical at all. It is just personal.

I know I am not the same person I was at twenty. The cells are different, the friends are mostly different, the city is different, the things I find funny are different. If I met that version of me now we would not be friends. We might not even like each other.

But I still feel continuous with him. There is a thread. I do not know what the thread is made of.

Memory is not enough. I forget most of my own life. The things I remember best are usually wrong in small ways. I have caught myself telling the same childhood story three different ways at three different dinners. So memory cannot be the thing.

Maybe it is taste. The things I am drawn to and the things I am repelled by have stayed weirdly stable. The same kinds of weather make me happy. The same tones in voices make me trust people. The same kinds of books bore me. That is closer to a self than memory is.

Or maybe a self is not a thing at all. Maybe it is a process. A story I keep retelling so I can stay coherent enough to make plans tomorrow. The story does not have to be true. It just has to be consistent enough that I can wake up and act like the same person.

That is a very practical theory of identity for three in the morning. I am going to sleep.`,
    seed_format: "markdown",
  },
  {
    key: "travel_chat_v1",
    name: "Travel Planning Free Form",
    channel: "email",
    description: "Long brainstorm about a possible trip that may never happen.",
    markdown: `# Trying to plan a trip to nowhere in particular

I keep opening flights and closing flights and I cannot decide on a destination. Every place I look at has some reason it is a bad idea right now. Too hot. Too crowded. Too expensive. Just got back from a place that was similar.

I think the actual problem is that I do not want to go somewhere. I want to feel like a different person for ten days. The destination is a proxy.

I noticed a pattern in the places I keep almost booking. They are all coastal, all cold, all north. None of them are warm beach destinations. I have been telling myself for years I am a beach person. I do not think I am. I think I have been doing what I was told a vacation should look like.

I tried to imagine a trip where I do nothing. No itinerary, no museums, no list of restaurants. Just a small town with a bookshop and a cafe and walking distance to water. I felt my shoulders drop two inches just imagining it.

So maybe that is the answer. Forget the destination. Pick the cafe. Find the cafe and pick the country it is in.

I am going to spend tonight searching for cafes instead of cities. I will let you know if anything works.`,
    seed_format: "markdown",
  },
  {
    key: "book_club_v1",
    name: "Book Club Aftermath",
    channel: "portal",
    description: "Notes from the meeting where everyone disagreed about the same novel.",
    markdown: `# Book club fell apart over this one and I am still thinking about it

We picked a short novel because we thought it would be easy to discuss. It was not easy. We could not even agree on what it was about.

One person read it as a love story between two people who could not communicate. Another read the same book as an indictment of the entire generation those characters belonged to. A third said it was actually about the city. They were not just emphasizing different aspects. They genuinely disagreed about the basic plot.

What I keep coming back to is that none of them were wrong. The book made room for all three readings on purpose. The author left enough space that different readers could project their own preoccupations into the story and have it confirm whatever they already believed.

I used to think that was a flaw. I am starting to think it is the entire point. The best books do not tell you what to think. They give you a structure stable enough to support several incompatible interpretations and let you find out which one you reached for.

If you read a book in a club with five people and you all come out with the same reading, the book was probably bad or you were probably all the same person.

We have not picked the next book yet. We are too tired.`,
    seed_format: "markdown",
  },
  {
    key: "journal_meta_v1",
    name: "Personal Journal Entry",
    channel: "manual_upload",
    description: "Free-form journal entry about a slow Thursday.",
    markdown: `# Thursday entry

Nothing happened today. That is the entry. But I am going to write it anyway because I have noticed I only journal on the dramatic days and I think that is making my memory of my own life lopsided.

I made coffee. The first cup was good. The second cup was somehow worse even though I made it the same way. I do not know how that is possible.

I worked on the same problem at my desk for almost three hours and made no progress. Then I stood up to refill my water and the answer arrived between the desk and the kitchen. I think the answer was always there and the problem was that I was sitting too still.

I had a brief conversation with a stranger at the corner. They asked for directions to a cafe that no longer exists. I told them. I did not tell them the cafe was gone. I do not know why. I felt like correcting them would be a small insult to a memory they were carrying that did not need to be corrected today.

I read for an hour. Made dinner. Watched something I had already seen, knowing I had seen it. There was a comfort in not being surprised.

This is what most days are. They are not stories. They are weather.`,
    seed_format: "markdown",
  },
  {
    key: "structured_projects_v1",
    name: "Project Tracker (Structured)",
    channel: "manual_upload",
    description: "Structured snapshot of in-flight engineering projects with status fields.",
    markdown: `# Engineering Projects Snapshot

This source is intentionally structured. Each project below has the same fields so it can be aggregated into a table view.

## Active Projects

| project_id | project_name | owner | priority | status | due_date | completion_pct |
| --- | --- | --- | --- | --- | --- | --- |
| PRJ-1001 | Migrate auth service | maya | high | in_progress | 2026-06-12 | 62 |
| PRJ-1002 | Rewrite billing webhook | jon | critical | blocked | 2026-05-22 | 30 |
| PRJ-1003 | Onboarding wizard v3 | nora | medium | in_progress | 2026-07-04 | 18 |
| PRJ-1004 | Feature flag cleanup | lee | low | review | 2026-05-30 | 88 |
| PRJ-1005 | Internal cost dashboard | sara | medium | in_progress | 2026-06-18 | 41 |
| PRJ-1006 | API rate limiter rollout | omar | high | testing | 2026-05-26 | 74 |
| PRJ-1007 | DB index audit | maya | low | in_progress | 2026-08-01 | 12 |
| PRJ-1008 | Customer SSO support | jon | critical | in_progress | 2026-06-09 | 55 |
| PRJ-1009 | Search relevance tuning | nora | high | in_progress | 2026-07-15 | 27 |
| PRJ-1010 | Pricing page experiment | sara | medium | review | 2026-05-29 | 92 |

## Notes

- Completion percentages are owner-reported and may not match QA reality.
- Blocked items typically need an external decision before they can move forward.`,
    seed_format: "markdown",
  },
  {
    key: "structured_inventory_v1",
    name: "Office Inventory (Structured)",
    channel: "portal",
    description: "Structured inventory of office equipment with assigned owners.",
    markdown: `# Office Inventory Snapshot

This source is the second structured one in the dataset. It tracks owned equipment in a single normalized table.

## Items

| asset_id | category | model | assigned_to | location | acquired_on | replacement_cost |
| --- | --- | --- | --- | --- | --- | --- |
| AST-2001 | laptop | MacBook Pro 14 | maya | hq-floor-3 | 2025-04-11 | 220000 |
| AST-2002 | laptop | MacBook Pro 16 | jon | remote-eu | 2024-11-02 | 280000 |
| AST-2003 | monitor | LG UltraFine 32 | nora | hq-floor-2 | 2024-06-19 | 95000 |
| AST-2004 | desk | Standing desk v2 | lee | hq-floor-3 | 2023-09-30 | 60000 |
| AST-2005 | chair | Ergo chair Pro | sara | remote-us | 2025-01-15 | 75000 |
| AST-2006 | phone | iPhone 15 | omar | hq-floor-1 | 2025-03-22 | 110000 |
| AST-2007 | tablet | iPad Pro 11 | maya | hq-floor-3 | 2024-12-08 | 130000 |
| AST-2008 | laptop | ThinkPad X1 | jon | remote-eu | 2025-02-04 | 180000 |
| AST-2009 | monitor | Dell U2723 | nora | hq-floor-2 | 2024-08-25 | 65000 |
| AST-2010 | headset | Sony WH-1000XM5 | sara | remote-us | 2025-05-12 | 35000 |

## Notes

- Replacement costs are stored in cents.
- Items in remote-* locations require shipping coordination before reassignment.`,
    seed_format: "markdown",
  },
];

const { data, error } = await supabase
  .from("sources")
  .insert(sources)
  .select("id,key,markdown");

if (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}

console.log(`inserted=${data.length}`);
for (const row of data) {
  console.log(`${row.key}: chars=${(row.markdown || "").length}`);
}
