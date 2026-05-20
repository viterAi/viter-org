import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Trace from the monorepo root so the /audit route can include files
  // outside apps/web (specifically the gitignored library/ folder).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/audit": ["../../library/**/*.md"],
  },
};

export default nextConfig;
