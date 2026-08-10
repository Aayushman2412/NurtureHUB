import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Derives the PWA icon set from the app logo (brand/logo-source.png — the
// mother-and-child mark cropped square out of the brand lockup, on the brand
// cream). Maskable/apple variants get generous padding and the same cream so
// the Android launcher mask and iOS rounding never clip the artwork.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: {
      sizes: [512],
      padding: 0.35,
      resizeOptions: { background: '#F8F5EF', fit: 'contain' },
    },
    apple: {
      sizes: [180],
      padding: 0.2,
      resizeOptions: { background: '#F8F5EF', fit: 'contain' },
    },
  },
  images: ['brand/logo-source.png'],
})
