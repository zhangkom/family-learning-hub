import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.FAMILY_SELF_HOSTED === 'true'
  ? { output: 'standalone', basePath: process.env.NEXT_PUBLIC_BASE_PATH || '/family-learning' }
  : {};

export default nextConfig;
