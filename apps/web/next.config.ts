import type { NextConfig } from "next";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), "../../.env") });

const config: NextConfig = {
  transpilePackages: ["@aiw/core"],
  serverExternalPackages: ["pg", "pg-boss", "dotenv"],
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
  experimental: {
    // Local-only convenience: uploads post through a server action. On Vercel
    // this must become a presigned URL direct to object storage, because
    // serverless request bodies cap near 4.5 MB.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default config;
