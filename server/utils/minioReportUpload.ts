import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'

export type MinioUploadStatus = 'skipped' | 'ok' | 'failed'

type MinioPrivateConfig = {
  endpoint: string
  accessKey: string
  secretKey: string
  bucket: string
  region: string
}

function readMinioConfig(): MinioPrivateConfig | null {
  const config = useRuntimeConfig()
  const m = config.minio as
    | {
        endpoint?: string
        accessKey?: string
        secretKey?: string
        bucket?: string
        region?: string
      }
    | undefined
  const endpoint = typeof m?.endpoint === 'string' ? m.endpoint.trim() : ''
  const accessKey = typeof m?.accessKey === 'string' ? m.accessKey.trim() : ''
  const secretKey = typeof m?.secretKey === 'string' ? m.secretKey.trim() : ''
  const bucket = typeof m?.bucket === 'string' ? m.bucket.trim() : ''
  const region =
    typeof m?.region === 'string' && m.region.trim() ? m.region.trim() : 'us-east-1'
  if (!endpoint || !accessKey || !secretKey || !bucket) return null
  return { endpoint, accessKey, secretKey, bucket, region }
}

function createS3Client(cfg: MinioPrivateConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKey,
      secretAccessKey: cfg.secretKey,
    },
    forcePathStyle: true,
  })
}

async function ensureBucketExists(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (e: unknown) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    const name = (e as { name?: string }).name
    if (status === 404 || name === 'NotFound') {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
      return
    }
    throw e
  }
}

/**
 * PDF’i MinIO (S3 uyumlu) bucket’a yükler. Yapılandırma eksikse atlanır.
 * @returns skipped | ok | failed
 */
export async function uploadCveReportPdfToMinio(params: {
  buffer: Buffer
  objectKey: string
}): Promise<MinioUploadStatus> {
  const cfg = readMinioConfig()
  if (!cfg) return 'skipped'

  const client = createS3Client(cfg)
  try {
    await ensureBucketExists(client, cfg.bucket)
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: params.objectKey,
        Body: params.buffer,
        ContentType: 'application/pdf',
      })
    )
    return 'ok'
  } catch (err) {
    console.error('[minio] CVE raporu yüklenemedi', err)
    return 'failed'
  }
}

export function buildMinioReportObjectKey(filenameAscii: string, y: string, mo: string, day: string): string {
  const safe = filenameAscii.replace(/[^\w.\-]/g, '_')
  return `reports/${y}/${mo}/${day}/${safe}`
}

async function readObjectBodyToBuffer(body: GetObjectCommandOutput['Body']): Promise<Buffer> {
  if (!body) return Buffer.alloc(0)
  const b = body as { transformToByteArray?: () => Promise<Uint8Array> }
  if (typeof b.transformToByteArray === 'function') {
    const u8 = await b.transformToByteArray()
    return Buffer.from(u8)
  }
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * MinIO’da `sync-report` ile aynı anahtardaki PDF’i okur. Yoksa veya hata olursa `null`.
 */
export async function fetchCveReportPdfFromMinio(objectKey: string): Promise<Buffer | null> {
  const cfg = readMinioConfig()
  if (!cfg) return null

  const client = createS3Client(cfg)
  try {
    const out = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey })
    )
    if (!out.Body) return null
    const buf = await readObjectBodyToBuffer(out.Body)
    return buf.length > 0 ? buf : null
  } catch (e: unknown) {
    const name = (e as { name?: string }).name
    const code = (e as { Code?: string }).Code
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (name === 'NoSuchKey' || code === 'NoSuchKey' || status === 404) {
      return null
    }
    console.warn('[minio] GetObject', objectKey, e)
    return null
  }
}
