import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Derives the PWA icon set from the EduPoshan mark (brand/logo.svg, the same
// drawing as src/components/brand/Logo.tsx). The maskable and Apple icons sit
// on the mark's own petrol teal, so the launcher mask and iOS rounding never
// show a light edge around the tile.
//
//   npx pwa-assets-generator && mv brand/*.png brand/*.ico public/
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: {
      sizes: [512],
      padding: 0.3,
      resizeOptions: { background: '#0F5562', fit: 'contain' },
    },
    apple: {
      sizes: [180],
      padding: 0.15,
      resizeOptions: { background: '#0F5562', fit: 'contain' },
    },
  },
  images: ['brand/logo.svg'],
})
