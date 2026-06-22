export default {
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
