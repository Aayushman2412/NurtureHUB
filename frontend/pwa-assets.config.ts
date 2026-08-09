import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Derives the PWA icon set from the app logo. The source SVG is slightly
// non-square (48x46 viewBox) with a transparent background, so maskable/apple
// variants get generous padding and the brand cream background to survive the
// Android launcher mask.
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
  images: ['public/favicon.svg'],
})
