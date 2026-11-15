import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "googleapis", "@resvg/resvg-js"],
  // Logo yüklemesi için (büyük demo videoları ayrı /api/upload ile akış olarak yüklenir)
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};
export default nextConfig;
