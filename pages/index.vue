<script setup lang="ts">
const url = ref('')
const mode = ref<'music' | 'video'>('music')
const quality = ref('best')
const format = ref('mp3')
const videoQuality = ref('720p')
const quantity = ref(10)
const loading = ref(false)
const job = ref<any>(null)
const error = ref('')
let timer: ReturnType<typeof setInterval> | null = null

const canStart = computed(() => /^https?:\/\/(www\.)?youtube\.com\/|^https?:\/\/youtu\.be\//i.test(url.value.trim()))
const quantityValid = computed(() => Number.isInteger(quantity.value) && quantity.value >= 1 && quantity.value <= 500)

async function startDownload() {
  error.value = ''
  job.value = null
  if (!canStart.value) {
    error.value = 'Introduce una URL válida de YouTube.'
    return
  }
  if (!quantityValid.value) {
    error.value = 'La cantidad debe estar entre 1 y 500 videos.'
    return
  }
  loading.value = true
  try {
    job.value = await $fetch('/api/download', {
      method: 'POST',
      body: {
        url: url.value.trim(),
        mode: mode.value,
        quality: mode.value === 'music' ? quality.value : videoQuality.value,
        format: mode.value === 'music' ? format.value : 'mp4',
        quantity: quantity.value
      }
    })
    poll()
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'No fue posible iniciar la descarga.'
  } finally {
    loading.value = false
  }
}

function poll() {
  if (timer) clearInterval(timer)
  timer = setInterval(async () => {
    if (!job.value?.id) return
    try {
      const data = await $fetch(`/api/jobs/${job.value.id}`)
      job.value = data
      if (['completed', 'error'].includes(data.status)) {
        if (timer) clearInterval(timer)
        timer = null
      }
    } catch {
      // keep polling if a transient error occurs
    }
  }, 1000)
}

function downloadFile() {
  if (!job.value?.id) return
  window.location.href = `/api/jobs/${job.value.id}/file`
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="page">
    <main class="container">
      <section class="hero">
        <div class="badge">▶ Playlist Downloader</div>
        <h1>Descarga tu playlist como <span>música</span> o video</h1>
        <p>Pega una playlist de YouTube, elige el formato y la calidad. La aplicación procesa la playlist en el servidor y prepara un archivo ZIP.</p>
      </section>

      <section class="card downloader">
        <label class="label">URL de la playlist</label>
        <div class="input-wrap">
          <input v-model="url" class="input" placeholder="https://www.youtube.com/playlist?list=..." @keyup.enter="startDownload" />
        </div>

        <div class="controls">
          <div>
            <label class="label">Tipo de descarga</label>
            <div class="segment">
              <button :class="{active: mode === 'music'}" @click="mode = 'music'">♫ Música</button>
              <button :class="{active: mode === 'video'}" @click="mode = 'video'">▣ Video</button>
            </div>
          </div>

          <div>
            <label class="label">Cantidad de videos</label>
            <input v-model.number="quantity" class="select" type="number" min="1" max="500" />
            <div class="hint">Se descargarán los primeros {{ quantity }} videos de la playlist.</div>
          </div>

          <div v-if="mode === 'music'">
            <label class="label">Calidad de audio</label>
            <select v-model="quality" class="select">
              <option value="best">Mejor disponible</option>
              <option value="320">320 kbps</option>
              <option value="256">256 kbps</option>
              <option value="192">192 kbps</option>
              <option value="128">128 kbps</option>
            </select>
          </div>
          <div v-else>
            <label class="label">Calidad de video</label>
            <select v-model="videoQuality" class="select">
              <option value="best">Mejor disponible</option>
              <option value="720p">Hasta 720p · máxima compatibilidad</option>
              <option value="1080p">Hasta 1080p · compatible</option>
              <option value="480p">Hasta 480p · archivos pequeños</option>
            </select>
          </div>

          <div v-if="mode === 'music'">
            <label class="label">Formato</label>
            <select v-model="format" class="select">
              <option value="mp3">MP3 · máxima compatibilidad</option>
            </select>
            <div class="hint">44.1 kHz · estéreo · MP3 estándar</div>
          </div>
          <div v-else>
            <label class="label">Formato compatible</label>
            <select class="select" disabled><option>MP4 · H.264 + AAC</option></select>
            <div class="hint">YUV420p · H.264 Main · AAC estéreo · optimizado para reproductores Android de carro</div>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-secondary" :disabled="loading" @click="url = ''; job = null; error = ''">Limpiar</button>
          <button class="btn btn-primary" :disabled="loading || !canStart || !quantityValid" @click="startDownload">{{ loading ? 'Preparando…' : 'Descargar playlist' }}</button>
        </div>

        <div v-if="error" class="notice error">{{ error }}</div>
        <div class="notice">Usa esta aplicación solamente con contenido que poseas o para el que tengas autorización para descargar. Necesitas un servidor Node con <strong>yt-dlp</strong> y <strong>FFmpeg</strong>.</div>
      </section>

      <section v-if="job" class="card status">
        <div class="status-top">
          <div class="status-title">{{ job.status === 'completed' ? '✅ Playlist lista' : job.status === 'error' ? '❌ Error' : 'Procesando playlist…' }}</div>
          <div class="small">{{ job.done }} / {{ job.total || job.quantity || '?' }} videos</div>
        </div>
        <div class="progress"><div :style="{ width: `${job.progress || 0}%` }"></div></div>
        <div v-if="job.message" class="small">{{ job.message }}</div>
        <div v-if="job.error" class="small error">{{ job.error }}</div>
        <div v-if="job.status === 'completed'" class="actions">
          <button class="btn btn-primary" @click="downloadFile">Descargar ZIP</button>
        </div>
      </section>

      <section class="features">
        <div class="card feature"><h3>♫ Música</h3><p>Convierte los elementos de la playlist a MP3 estándar, pensado para máxima compatibilidad con teléfonos, vehículos, TVs y reproductores antiguos.</p></div>
        <div class="card feature"><h3>▣ Video compatible</h3><p>Los videos se convierten a MP4 H.264 + AAC para evitar problemas con VP9, AV1 o HEVC en reproductores Android de carro.</p></div>
        <div class="card feature"><h3>⚙ Procesamiento por lotes</h3><p>El servidor empaqueta la playlist en un ZIP para que puedas descargarla como un solo archivo.</p></div>
      </section>

      <div class="footer">Playlist Downloader · Nuxt 3 · Node · yt-dlp · FFmpeg</div>
    </main>
  </div>
</template>
