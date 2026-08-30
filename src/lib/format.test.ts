import { describe, expect, it } from 'vitest'
import { compactCount } from './format'

describe('compactCount', () => {
  it('leaves small numbers alone', () => {
    expect(compactCount(0)).toBe('0')
    expect(compactCount(999)).toBe('999')
  })

  it('shortens thousands to at most one decimal', () => {
    expect(compactCount(1000)).toBe('1k')
    expect(compactCount(1500)).toBe('1.5k')
    expect(compactCount(1540)).toBe('1.5k')
    expect(compactCount(12_000)).toBe('12k')
  })

  it('shortens millions the same way', () => {
    expect(compactCount(1_000_000)).toBe('1m')
    expect(compactCount(2_500_000)).toBe('2.5m')
  })
})
