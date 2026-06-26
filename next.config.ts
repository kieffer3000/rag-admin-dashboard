export default {
  // Surfaces the deployed commit so the UI can show a build stamp — lets you
  // confirm you're on the latest code at a glance (cache-bust check).
  env: {
    NEXT_PUBLIC_BUILD: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)
  },
  // Excalidraw ships untranspiled ESM/JSX — Next must transpile it.
  transpilePackages: ['@excalidraw/excalidraw', '@excalidraw/mermaid-to-excalidraw'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        search: ''
      },
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
        search: ''
      }
    ]
  }
};
