import type { Source } from "./types";

export function eur(cents: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export const CHANNEL_DOMAINS: Record<string, string> = {
  gmail: "gmail.com", outlook: "outlook.com", email: "gmail.com",
  slack: "slack.com", whatsapp: "whatsapp.com", telegram: "telegram.org",
  facebook_messenger: "messenger.com", facebook: "facebook.com",
  instagram: "instagram.com", linkedin: "linkedin.com", twitter_x: "x.com",
  monday_com: "monday.com", notion: "notion.so", airtable: "airtable.com",
  google_sheets: "sheets.google.com", excel: "microsoft.com",
  hubspot: "hubspot.com", salesforce: "salesforce.com",
  zendesk: "zendesk.com", intercom: "intercom.com",
  onedrive: "onedrive.live.com", google_drive: "drive.google.com",
  dropbox: "dropbox.com", sharepoint: "sharepoint.com",
};

export function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    gmail: "Gmail", outlook: "Outlook", email: "Email",
    slack: "Slack", whatsapp: "WhatsApp", telegram: "Telegram",
    facebook_messenger: "Messenger", facebook: "Facebook",
    instagram: "Instagram", linkedin: "LinkedIn", twitter_x: "X / Twitter",
    monday_com: "Monday.com", notion: "Notion", airtable: "Airtable",
    google_sheets: "Google Sheets", excel: "Excel",
    hubspot: "HubSpot", salesforce: "Salesforce", zendesk: "Zendesk", intercom: "Intercom",
    onedrive: "OneDrive", google_drive: "Google Drive", dropbox: "Dropbox", sharepoint: "SharePoint",
    portal: "Portal / API", database: "Database", webhook: "Webhook",
    manual_upload: "Manual Upload",
  };
  return labels[channel] ?? channel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function channelDescription(channel: string): string {
  const descs: Record<string, string> = {
    gmail: "Email inbox", outlook: "Email", email: "Email",
    slack: "Team messaging", whatsapp: "Messaging", telegram: "Messaging", facebook_messenger: "Messaging",
    facebook: "Social & ads", instagram: "Social", linkedin: "Social", twitter_x: "Social",
    monday_com: "Project management", notion: "Docs & wikis", airtable: "Database", google_sheets: "Spreadsheets", excel: "Spreadsheets",
    hubspot: "CRM", salesforce: "CRM", zendesk: "Support", intercom: "Support",
    onedrive: "File storage", google_drive: "File storage", dropbox: "File storage", sharepoint: "Intranet",
    portal: "Web portal", database: "Database", webhook: "Live feed",
    manual_upload: "Manual data",
  };
  return descs[channel] ?? "Data source";
}

export function sourcePreview(s: Source): { rowCount: number | null; excerpt: string } {
  const md = (s.markdown ?? "").trim();
  if (!md) return { rowCount: null, excerpt: "No data yet" };
  const lines = md.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 1 && lines[0].includes(",")) {
    return { rowCount: lines.length - 1, excerpt: `${lines.length - 1} rows` };
  }
  try {
    const parsed = JSON.parse(md);
    if (Array.isArray(parsed)) return { rowCount: parsed.length, excerpt: `${parsed.length} records` };
  } catch { /* not JSON */ }
  const firstLine = lines.find((l) => l.replace(/^#+\s*/, "").trim().length > 10) ?? lines[0];
  const excerpt = (firstLine ?? "").replace(/^#+\s*/, "").slice(0, 55).trim();
  return { rowCount: null, excerpt: excerpt + ((firstLine?.length ?? 0) > 55 ? "…" : "") };
}

export const STEER_HINTS = [
  "Crossing the t's…",
  "Dotting the i's…",
  "Connecting the dots…",
  "Reading between the lines…",
  "Laying out components…",
  "Reviewing the structure…",
  "Untangling the data…",
  "Sharpening the layout…",
  "Checking the details…",
  "Almost there…",
];
