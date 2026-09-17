import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { sendStream } from 'h3'
import { jobs } from '../../../utils/jobs'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'ID de trabajo requerido.' })
  }

  const job = jobs.get(id)
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Trabajo no encontrado o expirado.' })
  }

  if (job.status === 'error') {
    throw createError({ statusCode: 409, statusMessage: job.error || 'La descarga falló.' })
  }

  if (job.status !== 'completed' || !job.file) {
    throw createError({ statusCode: 409, statusMessage: 'El archivo todavía no está disponible.' })
  }

  let info
  try {
    info = await stat(job.file)
  } catch {
    job.status = 'error'
    job.error = 'El ZIP se perdió antes de la descarga. Genera una nueva descarga.'
    throw createError({ statusCode: 404, statusMessage: job.error })
  }

  if (!info.isFile() || info.size < 22) {
    job.status = 'error'
    job.error = 'El ZIP está vacío o incompleto. Genera una nueva descarga.'
    throw createError({ statusCode: 404, statusMessage: job.error })
  }

  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="${basename(job.file)}"`)
  setHeader(event, 'Content-Length', String(info.size))

  return sendStream(event, createReadStream(job.file))
})
