import { createJob, initJobRoot, cleanupOldJobs } from '../utils/jobs'
import { runJob } from '../utils/runner'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const url = String(body?.url || '').trim()
  const mode = body?.mode === 'video' ? 'video' : 'music'
  const quality = String(body?.quality || 'best')
  const format = mode === 'music' ? String(body?.format || 'mp3') : 'mp4'
  const rawQuantity = Number(body?.quantity ?? 10)
  const quantity = Number.isFinite(rawQuantity) ? Math.trunc(rawQuantity) : 10

  let parsed: URL
  try { parsed = new URL(url) } catch { throw createError({ statusCode: 400, statusMessage: 'URL inválida.' }) }
  const host = parsed.hostname.toLowerCase()
  const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be'
  if (!isYouTube) throw createError({ statusCode: 400, statusMessage: 'Solo se admiten URLs de YouTube.' })
  if (!['mp3','m4a','opus'].includes(format) && mode === 'music') throw createError({ statusCode: 400, statusMessage: 'Formato no permitido.' })
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw createError({ statusCode: 400, statusMessage: 'La cantidad debe estar entre 1 y 500 videos.' })

  await initJobRoot()
  await cleanupOldJobs()
  const job = createJob({ mode, quality, format, quantity })
  void runJob(job.id, { url, mode, quality, format, quantity }).catch((err: any) => {
    const current = job
    current.status = 'error'
    current.error = err?.message || 'La descarga falló.'
    current.message = 'El proceso terminó con un error.'
  })

  return { id: job.id, status: job.status, done: job.done, total: job.total, progress: job.progress, message: job.message }
})
