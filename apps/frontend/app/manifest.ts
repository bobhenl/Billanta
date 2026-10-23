import type { MetadataRoute } from 'next';
import { SITE_NAME } from '@/lib/site';

/** Lets phones install the app to the home screen, launching straight into the dashboard. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: 'Invoicing for Czech and Slovak businesses: ISDOC, ARES, QR payments.',
    start_url: '/cs/dashboard',
    display: 'standalone',
    background_color: '#0b0c14',
    theme_color: '#0b0c14',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' }
    ]
  };
}
