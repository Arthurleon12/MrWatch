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

  it('promotes at the rounding boundary instead of printing "1000k"', () => {
    expect(compactCount(999_949)).toBe('1m')
    expect(compactCount(999_499)).toBe('999k')
  })

  it('shortens billions rather than printing "1000m"', () => {
    expect(compactCount(1_000_000_000)).toBe('1b')
    expect(compactCount(2_500_000_000)).toBe('2.5b')
    expect(compactCount(999_950_000)).toBe('1b')
  })

  it('never prints NaN for a count that is not a number', () => {
    expect(compactCount(NaN)).toBe('0')
    expect(compactCount(Infinity)).toBe('0')
    expect(compactCount(undefined as unknown as number)).toBe('0')
  })

  it('shortens a negative count like its positive twin', () => {
    expect(compactCount(-5)).toBe('-5')
    expect(compactCount(-1500)).toBe('-1.5k')
  })
})
