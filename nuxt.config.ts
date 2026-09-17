export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/main.css'],
  nitro: {
    preset: 'node-server'
  },
  app: {
    head: {
      title: 'Playlist Downloader',
      meta: [
        { name: 'description', content: 'Descarga playlists de YouTube como música o video.' }
      ]
    }
  }
})
