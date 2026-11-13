import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "googleapis", "@resvg/resvg-js"],
};
export default nextConfig;
