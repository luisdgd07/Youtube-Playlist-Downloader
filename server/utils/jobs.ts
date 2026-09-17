import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type JobStatus = 'queued' | 'running' | 'completed' | 'error'

export interface Job {
  id: string
  status: JobStatus
  mode: 'music' | 'video'
  quality: string
  format: string
  quantity: number
  total: number
  done: number
  progress: number
  message: string
  error?: string
  file?: string
  diagnostic?: { exitCode: number | null; stderr: string; stdout: string }
  createdAt: number
}

// process.cwd() is the Nuxt project root in dev/preview and remains stable for a normal Node deployment.
export const JOB_ROOT = join(process.cwd(), '.downloads')
export const jobs = new Map<string, Job>()

export async function initJobRoot() {
  await mkdir(JOB_ROOT, { recursive: true })
}

export function createJob(input: Pick<Job, 'mode' | 'quality' | 'format' | 'quantity'>) {
  const job: Job = {
    id: randomUUID(),
    status: 'queued',
    ...input,
    total: 0,
    done: 0,
    progress: 0,
    message: 'En cola…',
    createdAt: Date.now()
  }

  jobs.set(job.id, job)
  return job
}

export async function cleanupOldJobs(maxAgeMs = 1000 * 60 * 60 * 6) {
  const cutoff = Date.now() - maxAgeMs

  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id)
  }

  try {
    const entries = await readdir(JOB_ROOT, { withFileTypes: true })

    await Promise.all(entries.map(async entry => {
      const target = join(JOB_ROOT, entry.name)

      try {
        const age = Date.now() - (await stat(target)).mtimeMs
        if (age <= maxAgeMs) return

        if (entry.isDirectory()) {
          await rm(target, { recursive: true, force: true })
        } else if (entry.isFile() && (entry.name.endsWith('.zip') || entry.name.endsWith('.zip.part'))) {
          await rm(target, { force: true })
        }
      } catch {}
    }))
  } catch {}
}
