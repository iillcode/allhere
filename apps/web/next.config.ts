import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@stashwell/core", "@stashwell/library-ui"],
};

export default nextConfig;
