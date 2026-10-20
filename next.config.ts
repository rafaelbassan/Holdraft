import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mermaid", "node:sqlite"],
};

export default nextConfig;
