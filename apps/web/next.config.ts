import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@project-name/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
