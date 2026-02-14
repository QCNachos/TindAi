import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      // Add trusted image domains here as needed
      // { protocol: "https", hostname: "example.com" },
    ],
  },
};

export default nextConfig;
