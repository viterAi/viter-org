import type { Metadata } from "next";
import "./globals.css";
import { TokenProvider } from "@/lib/design/TokenProvider";

export const metadata: Metadata = {
  title: "Autonomous View Builder",
  description: "Shell-first v1 scaffold with Supabase persistence.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <TokenProvider>{children}</TokenProvider>
      </body>
    </html>
  );
}
