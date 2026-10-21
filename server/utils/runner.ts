import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { once } from 'node:events'
import { JOB_ROOT, jobs } from './jobs'

function commandExists(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [command], {
      windowsHide: true
    })
    child.on('close', code => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

async function resolveBinary(command: string) {
  if (await commandExists(command)) return command

  const candidates = [
    join(process.cwd(), command),
    join(process.cwd(), 'bin', command)
  ]

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }

  return null
}

async function ensureTools() {
  const yt = await resolveBinary(process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  const ff = await resolveBinary(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const hasYtDlp = Boolean(yt)
  const hasFfmpeg = Boolean(ff)

  if (!hasYtDlp) throw new Error('yt-dlp no está instalado o no está en PATH. Ejecuta "yt-dlp --version" en PowerShell para comprobarlo.')
  if (!hasFfmpeg) throw new Error('FFmpeg no está instalado o no está en PATH. Ejecuta "ffmpeg -version" en PowerShell para comprobarlo.')

  const hasX264 = await commandSupportsEncoder(ff!, 'libx264')
  const hasAac = await commandSupportsEncoder(ff!, 'aac')
  if (!hasX264) throw new Error('Tu FFmpeg no incluye el encoder libx264. Instala una compilación completa de FFmpeg para generar MP4 compatibles con reproductores Android de carro.')
  if (!hasAac) throw new Error('Tu FFmpeg no incluye el encoder AAC. Instala una compilación completa de FFmpeg.')

  const ytVersion = await commandVersion(yt!)
  if (ytVersion) console.log(`[youtube-playlist-downloader] yt-dlp ${ytVersion}`)
  console.log(`[youtube-playlist-downloader] Node ${process.versions.node}`)
  console.log(`[youtube-playlist-downloader] FFmpeg disponible`)
}

function commandVersion(command: string) {
  return new Promise<string | null>((resolve) => {
    execFile(command, ['--version'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null)
      resolve(String(stdout).trim().split(/\r?\n/)[0] || null)
    })
  })
}

function commandSupportsOption(command: string, option: string) {
  return new Promise<boolean>((resolve) => {
    execFile(command, ['--help'], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      const help = `${stdout || ''}\n${stderr || ''}`
      if (error && !help) return resolve(false)
      resolve(new RegExp(`(?:^|\\s)${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'm').test(help))
    })
  })
}

async function commandSupportsEncoder(command: string, encoder: string) {
  return new Promise<boolean>((resolve) => {
    execFile(command, ['-hide_banner', '-encoders'], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = `${stdout || ''}\n${stderr || ''}`
      if (error && !text) return resolve(false)
      resolve(new RegExp(`\\b${encoder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(text))
    })
  })
}

function nodeMajor() {
  return Number.parseInt(process.versions.node.split('.')[0] || '0', 10)
}

function argsFor(job: any, outDir: string, enableJsRuntime: boolean, enablePostprocessorArgs: boolean) {
  const output = join(outDir, '%(playlist_index)03d - %(title)s.%(ext)s')

  const common = [
    '--ignore-errors',
    '--no-overwrites',
    '--yes-playlist',
    '--restrict-filenames',
    '--newline',
    '--progress',
    '-o', output,
    '--playlist-end', String(job.quantity),
    job.url
  ]

  // Newer yt-dlp releases can solve YouTube JS challenges using Node.
  // Older versions do not recognize --js-runtimes, so only add the option
  // after checking the installed executable supports it.
  if (enableJsRuntime && nodeMajor() >= 22) {
    common.unshift('--js-runtimes', 'node')
  }

  if (job.mode === 'music') {
    const q = job.quality === 'best' ? '0' : job.quality
    // MP3 is the most compatible choice for phones, car stereos, TVs and
    // older media players. Keep the source audio selection, then force a
    // conventional MP3 layout during FFmpeg post-processing.
    if (enablePostprocessorArgs) {
      common.unshift(
        '--postprocessor-args',
        'ExtractAudio:-ar 44100 -ac 2 -id3v2_version 3 -write_id3v1 1'
      )
    }
    common.unshift('-x', '--audio-format', 'mp3', '--audio-quality', q)
    common.unshift('-f', 'bestaudio/best')
  } else {
    // Download the requested resolution first. The file is transcoded to a
    // conservative MP4 profile afterwards so Android car head units do not
    // depend on YouTube's original VP9/AV1/HEVC codec.
    let maxHeight = 1080
    if (/^\d+p$/.test(job.quality)) {
      maxHeight = Math.min(1080, Number(job.quality.replace('p', '')))
    }
    maxHeight = Math.max(360, maxHeight)

    const selector = `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]`
    common.unshift('-f', selector, '--merge-output-format', 'mp4')
  }

  return common
}


async function executeYtDlp(
  bin: string,
  args: string[],
  cwd: string,
  job: any,
  isFallback = false
) {
  return await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true })
    let stderr = ''
    let stdoutText = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      stdoutText += chunk.toString()
      if (stdoutText.length > 20000) stdoutText = stdoutText.slice(-20000)
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue

        const text = line.trim()
        const item = text.match(/Downloading item (\d+) of (\d+)/i)
        if (item) {
          job.total = Number(item[2])
          job.done = Math.max(0, Number(item[1]) - 1)
          job.progress = Math.round((job.done / Math.max(1, job.total)) * 100)
        }

        const percent = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/i)
        if (percent && job.total > 0) {
          const current = Number(percent[1]) / 100
          job.progress = Math.min(99, Math.round(((job.done + current) / job.total) * 100))
        }

        job.message = isFallback ? `[reintento] ${text}`.slice(0, 240) : text.slice(0, 240)
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk.toString()
      if (stderr.length > 20000) stderr = stderr.slice(-20000)
    })

    child.on('error', reject)
    child.on('close', code => {
      job.diagnostic = {
        exitCode: code,
        stderr: stderr.slice(-5000),
        stdout: stdoutText.slice(-5000)
      }

      if (code === 0 || code === 1) resolve()
      else reject(new Error(formatYtDlpError(stderr, stdoutText, code)))
    })
  })
}

export async function runJob(
  jobId: string,
  input: {
    url: string
    mode: 'music' | 'video'
    quality: string
    format: string
    quantity: number
  }
) {
  const job = jobs.get(jobId)
  if (!job) return

  job.status = 'running'
  job.total = input.quantity
  job.done = 0
  job.progress = 0
  job.message = `Preparando hasta ${input.quantity} videos…`

  await ensureTools()

  const outDir = join(JOB_ROOT, job.id)
  await mkdir(outDir, { recursive: true })

  const bin = await resolveBinary(process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (!bin) throw new Error('No se encontró yt-dlp.')

  const supportsJsRuntime = await commandSupportsOption(bin, '--js-runtimes')
  const supportsPostprocessorArgs = await commandSupportsOption(bin, '--postprocessor-args')
  if (supportsJsRuntime && nodeMajor() >= 22) {
    job.message = 'yt-dlp detectado con soporte de JavaScript; preparando descarga…'
  } else if (!supportsJsRuntime) {
    job.message = 'yt-dlp antiguo detectado; se ejecutará sin --js-runtimes…'
  }

  const baseArgs = argsFor({ ...job, ...input }, outDir, supportsJsRuntime, supportsPostprocessorArgs)
  await executeYtDlp(bin, baseArgs, outDir, job)

  let mediaFiles = (await readdir(outDir, { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name)

  // YouTube is currently changing client requirements. If the default client
  // produced nothing, retry once with web_safari, which can expose HLS formats
  // without a GVS PO token in the current extractor implementation.
  if (mediaFiles.length === 0) {
    job.message = 'Reintentando con el cliente alternativo de YouTube…'
    const fallbackArgs = ['--extractor-args', 'youtube:player_client=web_safari', ...baseArgs]
    await executeYtDlp(bin, fallbackArgs, outDir, job, true)
    mediaFiles = (await readdir(outDir, { withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
  }

  if (mediaFiles.length === 0) {
    const diagnostic = job.diagnostic
    const details = [diagnostic?.stderr, diagnostic?.stdout]
      .filter(Boolean)
      .join('\n')
      .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
      .trim()

    const helpful = extractUsefulYtDlpError(details)
    throw new Error(
      helpful ||
      'yt-dlp terminó pero no produjo archivos. Puede deberse a un bloqueo de YouTube, un desafío JavaScript, contenido privado/restringido o una versión antigua de yt-dlp. Revisa la consola del servidor para ver el diagnóstico completo.'
    )
  }

  if (job.mode === 'video') {
    const ffmpegBin = await resolveBinary(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    if (!ffmpegBin) throw new Error('No se encontró FFmpeg para convertir los videos a MP4 compatible.')
    mediaFiles = await transcodeVideosForAndroid(ffmpegBin, outDir, job)
  }

  job.done = Math.min(job.total, mediaFiles.length)
  job.message = `Preparando ZIP con ${mediaFiles.length} archivo(s)…`

  const zipPath = join(JOB_ROOT, `${job.id}.zip`)
  const tempZipPath = `${zipPath}.part`

  await createZip(outDir, tempZipPath)
  await verifyZip(tempZipPath)
  await rm(zipPath, { force: true })
  await rename(tempZipPath, zipPath)
  await verifyZip(zipPath)

  job.file = zipPath
  job.status = 'completed'
  job.done = mediaFiles.length
  job.total = Math.max(job.total, mediaFiles.length)
  job.progress = 100
  job.message = `${mediaFiles.length} archivo(s) listos.`
}


async function transcodeVideosForAndroid(
  ffmpegBin: string,
  sourceDir: string,
  job: any
) {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  const sources = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => /\.(mp4|webm|mkv|mov|avi|m4v|ts)$/i.test(name))

  if (sources.length === 0) return []

  const compatibleDir = join(sourceDir, '.compatible')
  await rm(compatibleDir, { recursive: true, force: true })
  await mkdir(compatibleDir, { recursive: true })

  const outputs: string[] = []

  for (let index = 0; index < sources.length; index++) {
    const inputName = sources[index]
    const inputPath = join(sourceDir, inputName)
    const outputName = inputName.replace(/\.[^.]+$/, '.mp4')
    const outputPath = join(compatibleDir, outputName)

    job.message = `Convirtiendo video ${index + 1} de ${sources.length} a H.264 + AAC…`

    await new Promise<void>((resolve, reject) => {
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-profile:v', 'main',
        '-level', '4.1',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-map_metadata', '0',
        outputPath
      ]

      const child = spawn(ffmpegBin, args, { cwd: sourceDir, windowsHide: true })
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
        if (stderr.length > 8000) stderr = stderr.slice(-8000)
      })
      child.on('error', reject)
      child.on('close', code => {
        if (code === 0) return resolve()
        reject(new Error(`FFmpeg no pudo convertir "${inputName}" a MP4 H.264/AAC.\n${stderr.trim()}`))
      })
    })

    const result = await stat(outputPath)
    if (!result.isFile() || result.size === 0) {
      throw new Error(`FFmpeg no generó correctamente el archivo "${outputName}".`)
    }

    outputs.push(outputName)
  }

  for (const name of sources) {
    await rm(join(sourceDir, name), { force: true })
  }

  for (const name of outputs) {
    await rename(join(compatibleDir, name), join(sourceDir, name))
  }

  await rm(compatibleDir, { recursive: true, force: true })
  return outputs
}

function formatYtDlpError(stderr: string, stdout: string, code: number | null) {
  const details = [stderr, stdout]
    .filter(Boolean)
    .join('\n')
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .trim()

  return extractUsefulYtDlpError(details) || `yt-dlp terminó con código ${code}`
}

function extractUsefulYtDlpError(text: string) {
  if (!text) return ''

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const patterns = [
    /ERROR:/i,
    /JavaScript/i,
    /EJS/i,
    /Sign in to confirm/i,
    /bot/i,
    /403/i,
    /private/i,
    /members-only/i,
    /age-restricted/i,
    /not available/i,
    /Unsupported URL/i,
    /Unable to extract/i
  ]

  const matches = lines.filter(line => patterns.some(pattern => pattern.test(line)))
  return (matches.length ? matches.slice(-8) : lines.slice(-8)).join('\n')
}

async function verifyZip(zipPath: string) {
  const info = await stat(zipPath)
  if (!info.isFile() || info.size < 22) {
    throw new Error('No se pudo crear un ZIP válido.')
  }
}

async function createZip(sourceDir: string, zipPath: string) {
  await rm(zipPath, { force: true })

  const { default: archiver } = await import('archiver')
  const output = createWriteStream(zipPath)
  const archive = archiver('zip', { zlib: { level: 9 } })

  const closePromise = once(output, 'close')
  const errorPromise = once(output, 'error').then(([error]) => {
    throw error
  })

  archive.on('error', error => output.destroy(error))
  archive.pipe(output)

  archive.glob('**/*', {
    cwd: sourceDir,
    dot: false,
    nodir: true
  })

  await archive.finalize()

  await Promise.race([closePromise, errorPromise])
}
