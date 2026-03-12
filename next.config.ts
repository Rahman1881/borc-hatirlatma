import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "xlsx", "whatsapp-web.js", "qrcode"],
};

export default nextConfig;
