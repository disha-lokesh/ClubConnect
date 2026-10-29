/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // keep the native-ish drivers out of the bundle
  serverExternalPackages: ['pg', 'mongodb', 'bcryptjs'],
  poweredByHeader: false,
};
export default nextConfig;
