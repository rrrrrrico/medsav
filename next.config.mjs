import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /\/data\/plans\.csv$/,
        handler: "CacheFirst",
        options: {
          cacheName: "medsav-catalog",
          expiration: {
            maxEntries: 4,
            maxAgeSeconds: 60 * 60 * 24 * 7,
          },
        },
      },
      {
        urlPattern: /\/data\/premiums\/.*\.csv$/,
        handler: "CacheFirst",
        options: {
          cacheName: "medsav-plan-premiums",
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          },
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default withPWA(nextConfig);
