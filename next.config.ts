import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Brokerage was renamed Investments.
  async redirects() {
    return [
      { source: "/brokerage", destination: "/investments", permanent: true },
      { source: "/brokerage/:id", destination: "/investments/:id", permanent: true },
      // Cash moved onto Home.
      { source: "/cash", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
