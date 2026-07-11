export interface UploadedImage {
  url: string
  type: string
}

interface SignResponse {
  cloud_name: string
  api_key: string
  timestamp: number
  folder: string
  allowed_formats: string
  signature: string
  max_bytes: number
}

const MAX_BYTES = 1024 * 1024 // 1 MB — mirrored server-side in the sign endpoint

/**
 * Direct-to-Cloudinary image upload (PRD §5.3): ask our server for a
 * signature, POST the file straight to Cloudinary, hand back the secure URL.
 * Used by both the widget composer and the Control Room composer.
 */
export function useImageUpload() {
  const uploading = ref(false)

  /** Throws with a human-readable message on validation or upload failure. */
  async function uploadImage(file: File, signBody: Record<string, string> = {}): Promise<UploadedImage> {
    if (!file.type.startsWith('image/')) {
      throw new Error('Only images can be attached')
    }
    if (file.size > MAX_BYTES) {
      throw new Error('Images must be smaller than 1 MB')
    }

    uploading.value = true
    try {
      const sig = await $fetch<SignResponse>('/api/attachments/sign', { method: 'POST', body: signBody })

      const form = new FormData()
      form.append('file', file)
      form.append('api_key', sig.api_key)
      form.append('timestamp', String(sig.timestamp))
      form.append('folder', sig.folder)
      form.append('allowed_formats', sig.allowed_formats)
      form.append('signature', sig.signature)

      const res = await $fetch<{ secure_url: string }>(
        `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`,
        { method: 'POST', body: form }
      )
      return { url: res.secure_url, type: file.type }
    } finally {
      uploading.value = false
    }
  }

  return { uploading, uploadImage }
}
