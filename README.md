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

## yt-dlp en Windows

La aplicación es compatible con versiones antiguas de yt-dlp en cuanto a argumentos: no envía `--js-runtimes` si el ejecutable instalado no reconoce esa opción.

Para YouTube actual se recomienda mantener yt-dlp actualizado:

```powershell
yt-dlp -U
yt-dlp --version
```

Las versiones recientes de yt-dlp soportan `--js-runtimes` y pueden usar Node/Deno para resolver desafíos JavaScript de YouTube. Si tienes una versión antigua, la aplicación intentará continuar sin ese argumento y mostrará el diagnóstico real si YouTube requiere un runtime moderno.

## Audio compatible

La descarga de música se genera en MP3 con FFmpeg a 44.1 kHz, estéreo e ID3v2.3 + ID3v1 cuando la versión de yt-dlp admite los argumentos de postprocesado; en versiones antiguas se mantiene MP3 estándar para maximizar la compatibilidad con teléfonos, equipos de carro, TVs y reproductores antiguos. yt-dlp documenta que `--audio-format mp3` usa FFmpeg para convertir el audio, y FFmpeg usa `libmp3lame` para la codificación MP3.


## Compatibilidad con reproductores Android de carro

El modo Video convierte los archivos descargados a un MP4 convencional con vídeo H.264/AVC, perfil Main, pixel format `yuv420p`, y audio AAC estéreo. También limita la resolución del modo Video a un máximo de 1080p y ofrece 720p como opción predeterminada para una mayor compatibilidad. Esto evita depender del códec original de YouTube (por ejemplo VP9, AV1 o HEVC), que algunos reproductores de coche no decodifican aunque el archivo sea `.mp4`. Android/Media3 admite MP4, pero el soporte final depende de los códecs del dispositivo.

La conversión requiere una compilación completa de FFmpeg que incluya `libx264` y `aac`.
