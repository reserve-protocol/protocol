import { assert, expect } from 'chai'
import { bn, fp, div, fpRound, fpCeil, fpFloor, shortString } from './numbers'
import { SCALE_DECIMALS, BN_SCALE_FACTOR, RoundingMode } from './constants'
import { BigNumber, BigNumberish } from 'ethers'

const N = BN_SCALE_FACTOR

describe('bn', () => {
  const table: [BigNumberish, BigNumberish][] = [
    ['1.0', 1n],
    ['1.1', 1n],
    ['-1', -1],
    ['-71', -71],
    ['-61.4', -61],
    ['-0.3', 0],
    ['000000000', 0],
    ['0.0', 0],
    ['1e18', 10n ** 18n],
    ['1e200', 10n ** 200n],
    ['123456789e-9', 0],
    ['123456789e-8', 1],
    ['123456789e-7', 12],
    ['2e0', 2],
    ['2e3', 2000],
    ['22e-1', 2],
    ['9999e-4', 0],
    ['999e-3', 0],
    ['999e-2', 9],
    ['54', 54],
    ['321', 321],
  ]
  for (const [input, output] of table) {
    it(`parses ${input}`, () => {
      expect(bn(input), `bn(${input})`).to.equal(output)
    })
  }

  const errorTable: string[] = [
    '.',
    '1.',
    '.3',
    '.0',
    '+',
    'a',
    '',
    ' ',
    '  ',
    'two',
    '3f2',
    '.2e9',
    '1.2x',
    'x1.2',
    '(1.2)',
  ]
  for (const input of errorTable) {
    it(`fails on "${input}"`, () => {
      expect(() => bn(input), `bn(${input})`).to.throw('Illegal decimal string')
    })
  }
})

describe('fp', () => {
  // z(n,zeroes) is n followed by `zeroes` zeroes
  const BN = BigNumber.from
  const z = (n: BigNumberish, zeroes: BigNumberish): BigNumber => BN(n).mul(BN(10).pow(zeroes))

  const table = [
    ['3.7', z(37, 17)],
    [3.9, z(39, 17)],
    ['0.32e2', z(32, 18)],
    [-1.5, z(-15, 17)],
    ['-0.1', z(-1, 17)],
    [0, 0],
    [0.0, 0],
    ['0.0', 0],
    ['123.4567e89', z(1234567, 103)],
    ['1e-18', 1],
    ['9e-19', 0],
    [0.1 + 0.2, z(3, 17)], // fp() rounds to 9 decimal places! 0.1 + 0.2 > 0.30000000000000004
    [1e-10, 0], // fp() rounds to 9 decimal places!
    ['-1e-18', -1],
    ['2e-18', 2],
    ['3e-18', 3],
  ]

  for (const [input, output] of table) {
    it(`correctly expands ${input}`, () => {
      expect(fp(input)).to.equal(BN(output))
    })
  }
})

describe('div', () => {
  // x, y, FLOOR result, ROUND result, CEIL result
  const table = [
    [10, 10, 1, 1, 1],
    [13, 10, 1, 1, 2],
    [15, 10, 1, 2, 2],
    [17, 10, 1, 2, 2],
    [20, 10, 2, 2, 2],
    [0, 10, 0, 0, 0],
    [1, 3, 0, 0, 1],
    [2, 3, 0, 1, 1],
  ]
    .flatMap(([x, y, fv, rv, cv]) => [
      [x, y, fv, rv, cv],
      [-x, y, -fv, -rv, -cv],
      [x, -y, -fv, -rv, -cv],
      [-x, -y, fv, rv, cv],
    ])
    .map(([x, y, fv, rv, cv]) => [bn(x), bn(y), bn(fv), bn(rv), bn(cv)])

  for (const [x, y, floorVal, roundVal, ceilVal] of table) {
    it(`div(${x},${y},FLOOR) == ${floorVal}`, () => {
      expect(div(x, y, RoundingMode.FLOOR)).to.equal(floorVal)
    })
    it(`div(${x},${y},ROUND) == ${roundVal}`, () => {
      expect(div(x, y, RoundingMode.ROUND)).to.equal(roundVal)
    })
    it(`div(${x},${y},CEIL)  == ${ceilVal}`, () => {
      expect(div(x, y, RoundingMode.CEIL)).to.equal(ceilVal)
    })
  }
})

describe('fpRound', () => {
  const table = [
    [1, 1],
    [1.2, 1],
    [1.5, 2],
    [1.8, 2],
    [2, 2],
    [0, 0],
    [-1, -1],
    [-1.2, -1],
    [-1.5, -2],
    [-1.8, -2],
    [-2, -2],
    [-2.5, -3],
    [2.5, 3],
  ]

  for (const [input, output] of table) {
    it(`fpRound(${input}) == ${output}`, () => {
      expect(fpRound(fp(input))).to.equal(fp(output))
    })
  }
})
describe('fpFloor', () => {
  const table = [
    [1, 1],
    [1.2, 1],
    [1.5, 1],
    [1.8, 1],
    [2, 2],
    [0, 0],
    [-1, -1],
    [-1.2, -1],
    [-1.5, -1],
    [-1.8, -1],
    [-2, -2],
  ]

  for (const [input, output] of table) {
    it(`fpFloor(${input}) == ${output}`, () => {
      expect(fpFloor(fp(input))).to.equal(fp(output))
    })
  }
})
describe('fpCeil', () => {
  const table = [
    [1, 1],
    [1.2, 2],
    [1.5, 2],
    [1.8, 2],
    [2, 2],
    [0, 0],
    [-1, -1],
    [-1.2, -2],
    [-1.5, -2],
    [-1.8, -2],
    [-2, -2],
  ]

  for (const [input, output] of table) {
    it(`fpCeil(${input}) == ${output}`, () => {
      expect(fpCeil(fp(input))).to.equal(fp(output))
    })
  }
})

describe('shortString', () => {
  const values = [
    '0',
    '-1',
    '1',
    '3000',
    '3e4',
    '9999',
    '-9999',
    '-1e4',
    '2.5e35',
    '-1.2345e7',
    '5.2e987',
  ]
  for (const val of values) {
    it(val, () => {
      expect(shortString(bn(val))).to.equal(val)
    })
  }
})
