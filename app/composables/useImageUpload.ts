export interface UploadedImage {
  url: string
  type: string
}

const MAX_BYTES = 1024 * 1024 // fast client feedback; the server enforces it too

/**
 * Size-bounded image upload through Perch, which authenticates the caller and
 * then forwards to Cloudinary without exposing a reusable upload signature.
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
