import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.wildapricot.org",
      },
    ],
  },
};

export default nextConfig;
