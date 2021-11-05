import { assert, expect } from 'chai'
import { bn, fp } from './numbers'
import { SCALE_DECIMALS } from './constants'
import { BigNumber, BigNumberish } from 'ethers'

describe('bn', () => {
  it('parses integers correctly', () => {
    const table: [BigNumberish, BigNumberish][] = [
      ['1.0', 1n],
      ['1.1', 1n],
      ['-1', -1],
      ['-71', -71],
      ['-61.4', -61],
      ['000000000', 0],
      ['0.0', 0],
      ['1e18', 10n ** 18n],
      ['1e200', 10n ** 200n],
      ['123456789e-10', 0],
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
      expect(bn(input), `bn(${input})`).to.equal(output)
    }
  })

  it('fails on strings with the wrong format', () => {
    const table: string[] = [
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
    for (const input of table) {
      expect(() => bn(input), `bn(${input})`).to.throw('Illegal decimal string')
    }
  })
})

describe('fp', () => {
  // z(n,zeroes) is n followed by `zeroes` zeroes
  const BN = BigNumber.from
  const z = (n: BigNumberish, zeroes: BigNumberish): BigNumber => BN(n).mul(BN(10).pow(zeroes))

  it('correctly expands values', () => {
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
      expect(fp(input), `fp(${input})`).to.equal(BN(output))
    }
  })
})
