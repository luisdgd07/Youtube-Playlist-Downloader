import { jobs } from '../../utils/jobs'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID de trabajo requerido.' })

  const job = jobs.get(id)
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Trabajo no encontrado o expirado.' })

  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    quality: job.quality,
    format: job.format,
    quantity: job.quantity,
    total: job.total,
    done: job.done,
    progress: job.progress,
    message: job.message,
    error: job.error || null
  }
})
