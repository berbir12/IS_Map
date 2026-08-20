import test from 'node:test'
import assert from 'node:assert/strict'
import { median } from '../src/lib/measurement.ts'
import { numericMedian, practicalCapacity } from '../src/lib/statistics.ts'

test('median is resistant to extreme outliers', () => {
  assert.equal(median([20, 21, 22, 5000]), 21.5)
  assert.equal(numericMedian([8, 2, 4]), 4)
})

test('capacity interpretation is conservative', () => {
  assert.deepEqual(practicalCapacity(100, 12, 28), {
    streams4k: 4,
    calls: 4,
    gaming: 'Excellent for online gaming',
  })
})
