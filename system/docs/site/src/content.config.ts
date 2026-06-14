import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// Extend the Starlight schema with an `audience` tag so every page declares
// who it serves — developers, AI agents, Hologram OS users — without forking
// the docs into three trees.
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        audience: z
          .array(z.enum(['users', 'developers', 'agents']))
          .optional(),
      }),
    }),
  }),
};
