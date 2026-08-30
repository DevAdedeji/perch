import { validateImageAttachment } from '@perch/shared'

export interface UploadedImage {
  url: string
  type: string
}

/**
 * Size-bounded image upload through Perch, which authenticates the caller and
 * then forwards to Cloudinary without exposing a reusable upload signature.
 * Used by both the widget composer and the Control Room composer.
 */
export function useImageUpload() {
  const uploading = ref(false)

  /** Throws with a human-readable message on validation or upload failure. */
  async function uploadImage(file: File, signBody: Record<string, string> = {}): Promise<UploadedImage> {
    const validationError = validateImageAttachment(file)
    if (validationError) throw new Error(validationError)

    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      for (const [key, value] of Object.entries(signBody)) form.append(key, value)
      return await $fetch<UploadedImage>('/api/attachments/upload', { method: 'POST', body: form })
    } finally {
      uploading.value = false
    }
  }

  return { uploading, uploadImage }
}
