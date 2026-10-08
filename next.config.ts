import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@mozilla/readability", "jsdom", "undici"],
};

export default nextConfig;
