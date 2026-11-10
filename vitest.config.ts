import { getViteConfig } from 'astro/config';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';

// Unit/container tests do not boot the Cloudflare dev runtime or a CMS database.
export default getViteConfig(defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}), {
  configFile: false,
  output: 'static',
  vite: { plugins: [tailwindcss()] },
});
