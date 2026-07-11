/**
 * Delivery-URL helper: inject a transformation into a Cloudinary image URL.
 * Thumbnails render fast in threads; clicking opens the untouched original.
 */
export function cldThumb(url: string, transform = 'w_480,c_limit,q_auto,f_auto'): string {
  return url.replace('/image/upload/', `/image/upload/${transform}/`)
}
