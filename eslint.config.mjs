import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  {
    ignores: ["coverage/**", "playwright-report/**", "test-results/**"],
  },
];

export default config;
