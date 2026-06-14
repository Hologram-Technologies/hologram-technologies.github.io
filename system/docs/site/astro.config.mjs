// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Static, serverless docs for Hologram OS.
// Builds to fully static HTML (default Astro output) so the result can itself be
// served as content-addressed κ objects — keeping Law L5 true of the docs.
//
// Deploys under /docs of the gateway's web root: the build is emitted straight
// into the repo-root `docs/` directory and all links carry the `/docs` base, so
// `index.html`'s "Docs" link → `docs/` resolves with no extra plumbing.
export default defineConfig({
  site: 'https://hologram.os',
  base: '/docs',
  outDir: '../../../docs',
  // Mirror the OS's own flat URL space; trailing-slash-free, hashable pages.
  trailingSlash: 'never',
  integrations: [
    starlight({
      title: 'Hologram OS',
      description:
        'A sovereign, serverless internet computer. Every object is self-verifying — its identity is the hash of its content (Law L5).',
      logo: {
        light: './src/assets/holo-mark-light.svg',
        dark: './src/assets/holo-mark-dark.svg',
        alt: 'Hologram OS',
      },
      customCss: ['./src/styles/brand.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Hologram-Technologies/hologram-os',
        },
      ],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      // Pagefind full-text search and dark mode ship by default.
      // Code blocks get copy buttons via Expressive Code by default.
      sidebar: [
        { label: 'Introduction', link: '/' },
        { label: 'Quickstart', link: '/quickstart' },
        // The rest of the IA is authored in the next increment:
        // Core concepts · For developers · For AI agents · Reference · Architecture / ADRs
      ],
    }),
  ],
});
