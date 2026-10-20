import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'معين - أستاذ العلوم الإسلامية',
    short_name: 'معين',
    description: 'منصة رقمية متكاملة مخصصة لأساتذة مادة العلوم الإسلامية بالتعليم الثانوي في الجزائر.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F8F9FA',
    theme_color: '#2E7D9B',
    icons: [
      {
        src: '/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand-logo-text.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand-logo-text.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
