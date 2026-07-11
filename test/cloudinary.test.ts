import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isOwnCloudinaryImageUrl, signCloudinaryParams } from '../server/utils/cloudinary'

describe('signCloudinaryParams', () => {
  it('signs sorted params exactly as Cloudinary expects', () => {
    const secret = 'shh-secret'
    // keys deliberately unsorted — the signature must sort them
    const sig = signCloudinaryParams({ timestamp: 1234, allowed_formats: 'jpg,png', folder: 'perch' }, secret)
    const expected = createHash('sha1')
      .update('allowed_formats=jpg,png&folder=perch&timestamp=1234' + secret)
      .digest('hex')
    expect(sig).toBe(expected)
  })

  it('different secrets produce different signatures', () => {
    const params = { timestamp: 1234, folder: 'perch' }
    expect(signCloudinaryParams(params, 'a')).not.toBe(signCloudinaryParams(params, 'b'))
  })
})

describe('isOwnCloudinaryImageUrl', () => {
  const cloud = 'perch-cloud'

  it('accepts https image URLs on our cloud', () => {
    expect(isOwnCloudinaryImageUrl(`https://res.cloudinary.com/${cloud}/image/upload/v123/perch/x.png`, cloud)).toBe(true)
  })

  it('rejects other clouds, hosts, schemes, and resource types', () => {
    expect(isOwnCloudinaryImageUrl('https://res.cloudinary.com/someone-else/image/upload/v1/x.png', cloud)).toBe(false)
    expect(isOwnCloudinaryImageUrl('https://evil.example.com/image/upload/x.png', cloud)).toBe(false)
    expect(isOwnCloudinaryImageUrl(`http://res.cloudinary.com/${cloud}/image/upload/x.png`, cloud)).toBe(false)
    expect(isOwnCloudinaryImageUrl(`https://res.cloudinary.com/${cloud}/video/upload/x.mp4`, cloud)).toBe(false)
    expect(isOwnCloudinaryImageUrl('not a url', cloud)).toBe(false)
  })

  it('fails closed when the cloud is not configured', () => {
    expect(isOwnCloudinaryImageUrl('https://res.cloudinary.com//image/upload/x.png', '')).toBe(false)
  })
})
