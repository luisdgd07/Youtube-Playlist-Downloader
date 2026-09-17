# YouTube Playlist Downloader

Nuxt 3 + Node para procesar playlists de YouTube como **Música** o **Video**.

## Incluye

- Selector Música / Video.
- URL de playlist de YouTube.
- Cantidad máxima de videos (1–500).
- Audio MP3, M4A u Opus.
- Calidad de audio configurable.
- Video MP4 hasta 720p, 1080p, 1440p o 4K.
- Progreso del procesamiento.
- ZIP generado en Node con `archiver`.
- Descarga del ZIP mediante `/api/jobs/:id/file`.
- Limpieza automática de trabajos antiguos.

## Requisitos

- Node.js 22+ recomendado (yt-dlp usa Node 22+ como runtime JavaScript compatible para los desafíos actuales de YouTube).
- `yt-dlp` disponible en PATH.
- `FFmpeg` disponible en PATH.

En Windows puedes comprobarlos con:

```powershell
yt-dlp --version
ffmpeg -version
```

## Instalación

```bash
npm install
npm run dev
```

Luego abre:

```text
http://localhost:3000
```

## Cantidad de videos

El campo **Cantidad de videos** limita el procesamiento con `--playlist-end` de `yt-dlp`.

Ejemplo: `10` procesa como máximo los primeros 10 elementos disponibles de la playlist. Si algún video está eliminado, privado o no se puede descargar, el número final puede ser menor.

## Importante

La aplicación debe utilizarse solamente con contenido para el que tengas derechos o autorización de descarga. Revisa además los términos de uso de YouTube y las leyes aplicables.
