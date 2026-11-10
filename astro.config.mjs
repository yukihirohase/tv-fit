import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import emdash from 'emdash/astro';
import { d1, r2 } from '@emdash-cms/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { tvFitValidation } from './plugins/tv-fit-validation/index.ts';

export default defineConfig({
  output: 'server',
  trailingSlash: 'ignore',
  session: { driver: { entrypoint: new URL('./src/lib/session-storage.ts', import.meta.url) } },
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [
    react(),
    emdash({
      database: d1({ binding: 'DB', session: 'auto', coalesce: true }),
      storage: r2({ binding: 'MEDIA' }),
      plugins: [tvFitValidation()],
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
