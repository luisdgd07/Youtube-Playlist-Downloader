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

function nodeMajor() {
  return Number.parseInt(process.versions.node.split('.')[0] || '0', 10)
}

function argsFor(job: any, outDir: string) {
  const output = join(outDir, '%(playlist_index)03d - %(title)s.%(ext)s')

  const common = [
    '--ignore-errors',
    '--no-overwrites',
    '--yes-playlist',
    '--restrict-filenames',
    '--newline',
    '--progress',
    '--no-warnings',
    '-o', output,
    '--playlist-end', String(job.quantity),
    job.url
  ]

  // Current yt-dlp releases use EJS to solve YouTube's JavaScript challenges.
  // Node 22+ is a supported JS runtime; enable it automatically when available.
  if (nodeMajor() >= 22) {
    common.unshift('--js-runtimes', 'node')
  }

  if (job.mode === 'music') {
    const q = job.quality === 'best' ? '0' : job.quality
    common.unshift('-x', '--audio-format', job.format, '--audio-quality', q)
    common.unshift('-f', 'bestaudio/best')
  } else {
    let selector = 'bv*+ba/b'
    if (/^\d+p$/.test(job.quality)) {
      const h = Number(job.quality.replace('p', ''))
      selector = `bv*[height<=${h}]+ba/b[height<=${h}]`
    }
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

  const baseArgs = argsFor({ ...job, ...input }, outDir)
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
