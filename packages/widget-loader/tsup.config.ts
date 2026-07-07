import { defineConfig } from 'tsup'

// Builds the embeddable loader straight into the Nuxt app's public dir → /widget.js
export default defineConfig({
  entry: { widget: 'src/index.ts' },
  outDir: '../../public',
  format: ['iife'],
  outExtension: () => ({ js: '.js' }),
  minify: true,
  clean: false,
  dts: false,
  platform: 'browser',
  target: 'es2019'
})
