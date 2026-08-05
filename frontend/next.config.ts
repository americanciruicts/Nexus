import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Enable gzip/brotli compression
  compress: true,
  // Optimize production builds
  productionBrowserSourceMaps: false,
  // Optimize package imports - only import what's used
  experimental: {
    optimizePackageImports: ['@heroicons/react', 'date-fns', 'sonner'],
  },
  // Reduce powered-by header
  poweredByHeader: false,
  // Reverse-proxy the rithomiq Odoo formio service so the embedded maintenance
  // form is served same-origin. Cross-origin loads get blocked by the form's
  // session cookies, causing silent submission failures.
  async rewrites() {
    return [
      { source: '/formsm/:path*', destination: 'https://aci.rithomiq.com/formsm/:path*' },
      { source: '/formio/:path*', destination: 'https://aci.rithomiq.com/formio/:path*' },
      { source: '/web/:path*', destination: 'https://aci.rithomiq.com/web/:path*' },
      { source: '/longpolling/:path*', destination: 'https://aci.rithomiq.com/longpolling/:path*' },
    ];
  },
  // SAMEORIGIN (not DENY) so the maintenance page can embed the reverse-proxied
  // rithomiq form iframe as same-origin. External sites still can't frame us.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
