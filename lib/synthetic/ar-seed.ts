import { readFile } from "node:fs/promises";
import path from "node:path";

export type SourceChannel = "whatsapp" | "email" | "portal" | "manual_upload";

export interface SourceSeedRecord {
  key: string;
  name: string;
  channel: SourceChannel;
  description: string;
  markdown: string;
  seed_format: "markdown" | "json" | "csv";
}

export interface SyntheticInvoice {
  source_key: string;
  invoice_id: string;
  client_name: string;
  amount_cents: number;
  due_date: string;
  status: "current" | "due_1_30" | "due_31_60" | "due_61_plus";
  follow_up_status: "todo" | "in_progress" | "followed_up";
  assignee: string;
}

export interface MarkdownSeedDataset {
  sources: SourceSeedRecord[];
  invoices: SyntheticInvoice[];
}

const DATASET_PATH = path.join(process.cwd(), "data", "source-datasets.md");

function getChannel(value: string): SourceChannel {
  if (
    value === "whatsapp" ||
    value === "email" ||
    value === "portal" ||
    value === "manual_upload"
  ) {
    return value;
  }
  throw new Error(`Invalid channel in markdown seed: ${value}`);
}

function splitMarkdownTableRow(row: string): string[] {
  const trimmed = row.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    throw new Error(`Invalid markdown table row: ${row}`);
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((item) => item.trim());
}

function readTableRows(markdown: string, sectionTitle: string): string[] {
  const sectionStart = markdown.indexOf(`## ${sectionTitle}`);
  if (sectionStart === -1) {
    return [];
  }

  const sectionBody = markdown.slice(sectionStart).split("\n## ")[0] ?? "";
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
}

export async function getMarkdownSeedDataset(): Promise<MarkdownSeedDataset> {
  const markdown = await readFile(DATASET_PATH, "utf8");
  const sourceRows = readTableRows(markdown, "Sources");
  const invoiceRows = readTableRows(markdown, "Invoices");

  const parsedSources = sourceRows.slice(2).map((row) => {
    const [key, name, channel, description] = splitMarkdownTableRow(row);
    return {
      key,
      name,
      channel: getChannel(channel),
      description,
    };
  });
  const extraSources: Array<{
    key: string;
    name: string;
    channel: SourceChannel;
    description: string;
  }> = [
    {
      key: "ops_manual",
      name: "Ops Manual Intake Queue",
      channel: "manual_upload",
      description: "Manual ops drops with mixed formatting and delayed handoff.",
    },
    {
      key: "legal_portal",
      name: "Legal Portal Exceptions",
      channel: "portal",
      description: "Contract exceptions and clause disputes with uneven metadata.",
    },
    {
      key: "support_email",
      name: "Support Escalation Mailbox",
      channel: "email",
      description: "Escalated support finance threads with repeated context drift.",
    },
    {
      key: "sales_whatsapp",
      name: "Sales WhatsApp Negotiations",
      channel: "whatsapp",
      description: "Quote and payment negotiation chatter with rapid state changes.",
    },
    {
      key: "revops_batch",
      name: "RevOps Batch Reconciliation",
      channel: "manual_upload",
      description: "Batch-level reconciliation runs with partial and duplicate joins.",
    },
  ];
  const baseSources = [...parsedSources, ...extraSources];

  const baseInvoices: SyntheticInvoice[] = invoiceRows.slice(2).map((row) => {
    const [
      source_key,
      invoice_id,
      client_name,
      amount_cents,
      due_date,
      status,
      follow_up_status,
      assignee,
    ] = splitMarkdownTableRow(row);

    return {
      source_key,
      invoice_id,
      client_name,
      amount_cents: Number(amount_cents),
      due_date,
      status: status as SyntheticInvoice["status"],
      follow_up_status: follow_up_status as SyntheticInvoice["follow_up_status"],
      assignee,
    };
  });

  const topics = [
    "compliance",
    "translation",
    "procurement",
    "incident",
    "quality",
    "renewal",
    "onboarding",
    "legal",
    "support",
    "operations",
  ];
  const regions = ["EU", "US", "APAC", "LATAM"];
  const milestones = ["draft", "review", "approval", "delivery", "blocked"];
  const departments = ["AP", "AR", "Ops", "RevOps", "Support"];
  const priorities = ["low", "medium", "high", "critical"];

  const invoices: SyntheticInvoice[] = [...baseInvoices];
  const additionalCount = 1900;
  const sourceKeys = baseSources.map((source) => source.key);
  const statusCycle: SyntheticInvoice["status"][] = [
    "current",
    "due_1_30",
    "due_31_60",
    "due_61_plus",
  ];
  const followUpCycle: SyntheticInvoice["follow_up_status"][] = [
    "todo",
    "in_progress",
    "followed_up",
  ];
  const assignees = ["maya", "jon", "nora", "lee", "sara", "omar"];
  const noTableSourceKeys = new Set(["sales_whatsapp", "support_email", "legal_portal"]);
  const noteFragments = [
    "customer replied from a forwarded thread and removed invoice context",
    "owner changed twice in one day due to handoff gap",
    "status updated before payment evidence was uploaded",
    "duplicate entity appears with slightly different legal name",
    "regional tag disagrees with billing currency",
    "follow-up asked for bundled payment plan",
    "risk spike observed after procurement freeze window",
    "record partially synced; some fields were backfilled later",
  ];

  for (let i = 0; i < additionalCount; i += 1) {
    const sourceKey = sourceKeys[i % sourceKeys.length];
    const invoiceId = `INV-${(2000 + i).toString().padStart(4, "0")}`;
    const clientName = `${topics[i % topics.length]}-${regions[i % regions.length]}-${i}`;
    const amountCents = 150000 + ((i * 13791) % 1900000);
    const month = ((i % 12) + 1).toString().padStart(2, "0");
    const day = (((i * 3) % 27) + 1).toString().padStart(2, "0");
    const dueDate = `2026-${month}-${day}`;

    invoices.push({
      source_key: sourceKey,
      invoice_id: invoiceId,
      client_name: clientName,
      amount_cents: amountCents,
      due_date: dueDate,
      status: statusCycle[i % statusCycle.length],
      follow_up_status: followUpCycle[i % followUpCycle.length],
      assignee: assignees[i % assignees.length],
    });
  }

  const sources: SourceSeedRecord[] = baseSources.map((source) => {
    const sourceInvoices = invoices.filter((invoice) => invoice.source_key === source.key);
    const transcriptRows = sourceInvoices.slice(0, 320).map((invoice, index) => {
      const day = ((index % 28) + 1).toString().padStart(2, "0");
      const hour = (8 + (index % 11)).toString().padStart(2, "0");
      const minute = ((index * 7) % 60).toString().padStart(2, "0");
      const note = noteFragments[index % noteFragments.length];
      const actor = index % 2 === 0 ? invoice.assignee : "client";
      if (source.key === "sales_whatsapp") {
        return `- [2026-05-${day} ${hour}:${minute}] ${actor}: invoice ${invoice.invoice_id} for ${invoice.client_name} is ${invoice.status}; ${note}. amount=${invoice.amount_cents} follow_up=${invoice.follow_up_status}`;
      }
      if (source.key === "support_email") {
        return `- [2026-05-${day} ${hour}:${minute}] ${actor}: escalation on ${invoice.invoice_id} (${invoice.client_name}) due ${invoice.due_date}; ${note}; owner=${invoice.assignee}; state=${invoice.follow_up_status}`;
      }
      return `- [2026-05-${day} ${hour}:${minute}] ${actor}: call transcript for ${invoice.invoice_id} with ${invoice.client_name}. Mentioned ${note}. commitment=partial_payment status=${invoice.status}`;
    });
    const markdownRows = sourceInvoices.map((invoice, index) => {
      const topic = topics[index % topics.length];
      const priority = priorities[index % priorities.length];
      const department = departments[index % departments.length];
      const milestone = milestones[index % milestones.length];
      const region = regions[index % regions.length];
      const risk = ((index * 7) % 100) + 1;
      const signal = noteFragments[index % noteFragments.length];

      if (source.key === "wappa_primary") {
        return `| ${invoice.invoice_id} | ${invoice.client_name} | ${topic} | ${priority} | ${invoice.amount_cents} | ${invoice.due_date} | ${invoice.status} | ${invoice.follow_up_status} | ${invoice.assignee} | 2026-05-${((index % 28) + 1).toString().padStart(2, "0")} |`;
      }
      if (source.key === "finance_email") {
        return `| ${invoice.invoice_id} | ${invoice.client_name} | ${department} | ${region} | ${invoice.amount_cents} | EUR | ${invoice.due_date} | ${invoice.status} | ${invoice.follow_up_status} | ${invoice.assignee} | ${risk} | ${signal} |`;
      }
      return `| ${invoice.invoice_id} | ${invoice.client_name} | PRJ-${1000 + index} | ${milestone} | ${invoice.amount_cents} | ${invoice.due_date} | ${invoice.status} | ${invoice.follow_up_status} | ${invoice.assignee} | ${24 + (index % 96)} | ${signal} |`;
    });

    let header =
      "| invoice_id | client_name | amount_cents | due_date | status | follow_up_status | assignee |";
    let divider = "| --- | --- | --- | --- | --- | --- | --- |";
    if (source.key === "wappa_primary") {
      header =
        "| invoice_id | client_name | topic | priority | amount_cents | due_date | status | follow_up_status | assignee | last_message_at |";
      divider =
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
    } else if (source.key === "finance_email") {
      header =
        "| invoice_id | client_name | department | region | amount_cents | currency | due_date | status | follow_up_status | assignee | risk_score | context_note |";
      divider =
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
    } else if (source.key === "partner_portal") {
      header =
        "| invoice_id | client_name | project_code | milestone | amount_cents | due_date | status | follow_up_status | assignee | sla_hours | context_note |";
      divider =
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
    } else if (
      source.key === "ops_manual" ||
      source.key === "legal_portal" ||
      source.key === "support_email" ||
      source.key === "sales_whatsapp" ||
      source.key === "revops_batch"
    ) {
      header =
        "| invoice_id | client_name | topic | department | priority | amount_cents | due_date | status | follow_up_status | assignee | context_note |";
      divider =
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
    }

    const narrativeLines = sourceInvoices.slice(0, 140).map((invoice, index) => {
      const note = noteFragments[(index + 3) % noteFragments.length];
      return `- ${invoice.invoice_id} (${invoice.client_name}): ${note}. Current owner is ${invoice.assignee}, latest status is ${invoice.status}.`;
    });

    if (noTableSourceKeys.has(source.key)) {
      const markdown = [
        `# ${source.name} daily operational feed`,
        "",
        "## Overview",
        `This source is intentionally unstructured and stored as conversational logs for **${source.name}**.`,
        "Messages include repeated mentions, partial commitments, and contradictory updates across time.",
        "",
        "## Conversation stream",
        ...transcriptRows,
        "",
        "## Call wrap-up",
        "- Team should aggregate repeated invoice mentions by id and latest timestamp.",
        "- Owner changes are embedded in free text and may conflict with old status labels.",
      ].join("\n");

      return {
        ...source,
        markdown,
        seed_format: "markdown",
      };
    }

    const markdown = [
      `# ${source.name} daily operational feed`,
      "",
      "## Overview",
      `This source simulates mixed real-world operational chatter and document traffic for **${source.name}**.`,
      "Records include repetitive daily workflows, inconsistent tags, and occasional contradictory states that usually appear in production data.",
      "",
      "## Why this source is noisy",
      "- Some records repeat daily with slight field drift.",
      "- Priority and status can conflict during handoff windows.",
      "- Regional and departmental labels are not always normalized.",
      "- Time-series context matters more than any single row.",
      "",
      "## Suggested dashboard focus",
      "- Surface overdue and at-risk items first.",
      "- Show trend + queue composition side by side.",
      "- Keep drilldown on the latest interaction context.",
      "",
      "## Records",
      header,
      divider,
      ...markdownRows,
      "",
      "## Daily repeat behavior",
      "Expect similar entities to reappear with new timestamps, updated owners, and partial status transitions.",
      "This is intentional and should trigger re-aggregation rather than one-time table rendering.",
      "",
      "## Operator notes stream",
      ...narrativeLines,
    ].join("\n");

    return {
      ...source,
      markdown,
      seed_format: "markdown",
    };
  });

  return { sources, invoices };
}

export function defaultAgingTableSpec() {
  return {
    view_id: "aging-table",
    view_name: "Aging Table",
    view_type: "aging_table",
    layout: {
      primitive: "DataTable",
      columns: [
        "invoice_id",
        "client_name",
        "amount_cents",
        "due_date",
        "status",
        "follow_up_status",
      ],
    },
    bindings: {
      dataset: "source_rows",
      filters: ["status", "assignee"],
      actions: ["mark_followed_up"],
    },
  };
}

export function defaultKanbanSpec() {
  return {
    view_id: "follow-up-kanban",
    view_name: "Follow-up Kanban",
    view_type: "follow_up_kanban",
    layout: {
      primitive: "KanbanBoard",
      group_by: "follow_up_status",
      card_fields: ["invoice_id", "client_name", "amount_cents", "status"],
    },
    bindings: {
      dataset: "source_rows",
      actions: ["move_card", "mark_followed_up"],
    },
  };
}
