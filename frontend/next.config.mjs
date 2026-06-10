/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // essentia.js ships a UMD build that references Node core modules
      // (`fs`, `path`). They are unused in the browser WASM path, so stub them
      // out for the client bundle instead of failing to resolve.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
