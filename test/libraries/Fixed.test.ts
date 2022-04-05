import { expect } from 'chai'
import { ContractFactory, BigNumber } from 'ethers'
import { ethers } from 'hardhat'

import { BN_SCALE_FACTOR } from '../../common/constants'
import { bn, fp, pow10 } from '../../common/numbers'
import { FixedCallerMock } from '../../typechain/FixedCallerMock'

enum RoundingApproach {
  FLOOR,
  ROUND,
  CEIL,
}

describe('In FixLib,', () => {
  let FixedCaller: ContractFactory
  let caller: FixedCallerMock

  const neg = (x: BigNumber) => x.mul(-1)

  const SCALE = BN_SCALE_FACTOR
  const MAX_INT192 = BigNumber.from(2).pow(191).sub(1)
  const MIN_INT192 = neg(BigNumber.from(2).pow(191))
  const MAX_UINT192 = BigNumber.from(2).pow(192).sub(1)
  const MAX_FIX_INT = MAX_INT192.div(pow10(18)) // biggest integer N st toFix(N) exists
  const MIN_FIX_INT = MIN_INT192.div(pow10(18)) // smallest integer N st toFix(N) exists
  const MAX_INT256 = BigNumber.from(2).pow(255).sub(1)

  // prettier-ignore
  const fixable_ints: BigNumber[] = [
    bn(0), bn(1), bn(-1), MAX_FIX_INT, MIN_FIX_INT, MAX_FIX_INT.sub(1), MIN_FIX_INT.add(1),
    bn('38326665875765560393'), bn('-01942957121544002253')
  ]
  // prettier-ignore
  const positive_int192s: BigNumber[] = [
    bn(1), fp(0.9999), fp(1), fp(1.0001), MAX_INT192.sub(1), MAX_INT192
  ]
  const negative_int192s = positive_int192s.map(neg)
  negative_int192s.reverse()

  const int192s: BigNumber[] = [MIN_INT192, ...negative_int192s, bn(0), ...positive_int192s]

  // This is before() instead of beforeEach():
  // All of these functions are pure, so the contract state can be reused.
  before(async () => {
    FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  describe('intToFix', () => {
    it('correctly converts int values', async () => {
      for (const x of fixable_ints) {
        expect(await caller.intToFix_(x), `${x}`).to.equal(fp(x))
      }
    })
    it('fails on values outside its domain', async () => {
      const table = [MAX_FIX_INT.add(1), MIN_FIX_INT.sub(1), MAX_FIX_INT.mul(25)]
      for (const x of table) {
        await expect(caller.intToFix_(x)).to.be.revertedWith('IntOutOfBounds')
      }
    })
  })

  describe('toFix(x)', () => {
    it('correctly converts uint values', async () => {
      const table = [0, 1, 2, '38326665875765560393', MAX_FIX_INT.sub(1), MAX_FIX_INT].map(bn)
      for (const x of table) {
        expect(await caller.toFix_(x), `${x}`).to.equal(fp(x))
      }
    })

    it('fails on inputs outside its domain', async () => {
      await expect(caller.toFix_(MAX_FIX_INT.add(1))).to.be.revertedWith('UIntOutOfBounds')
      await expect(caller.toFix_(MAX_FIX_INT.mul(17))).to.be.revertedWith('UIntOutOfBounds')
    })
  })

  describe('toFix(x, shiftLeft)', () => {
    it('correctly converts uint values with no shifting', async () => {
      const table = [0, 1, 2, '38326665875765560393', MAX_FIX_INT.sub(1), MAX_FIX_INT].map(bn)
      for (const x of table) {
        expect(await caller.toFixWithShift_(x, bn(0)), `${x}`).to.equal(fp(x))
      }
    })

    it('correctly converts uint values with some shifting', async () => {
      const table = [
        [0, 10],
        [1, 5],
        [1, -7],
        [2, 3],
        [2, -3],
        ['38326665875765560393', -10],
        ['38326665875', 9],
        [MAX_FIX_INT.sub(1), -2],
        [MAX_FIX_INT.sub(1), -1],
        [MAX_FIX_INT.sub(1), 0],
        [MAX_FIX_INT, -9],
        [MAX_FIX_INT, -1],
      ].map(([x, s]) => [bn(x), bn(s)])

      for (const [x, s] of table) {
        expect(await caller.toFixWithShift_(x, s), `toFixWithShift(${x}, ${s})`).to.equal(
          s.gte(0) ? fp(x).mul(pow10(s)) : fp(x).div(pow10(neg(s)))
        )
      }
    })

    it('fails on inputs outside its domain', async () => {
      const table = [
        [MAX_FIX_INT, 1],
        [MAX_FIX_INT.add(1), 0],
        [MIN_FIX_INT, 1],
        [MIN_FIX_INT.sub(1), 0],
        [1, 58],
        [-1, 58],
        [bn('1e8'), 50],
        [bn('-1e8'), 50],
        [bn('5e56'), 2],
        [bn('-5e56'), 2],
      ]

      for (const [x, s] of table) {
        await expect(caller.toFixWithShift_(x, s), `toFix(${x}, ${s})`).to.be.reverted
      }
    })
  })

  describe('divFix', () => {
    it('correctly divides inside its range', async () => {
      // prettier-ignore
      const table = [[10, 1, 10], [10, 2, 5], [20, 2.5, 8], [1, 5, 0.2], [256, 256, 1]]
          .flatMap(([x, y, z]) => [
            [x, y, z],
            [x, -y, -z],
            [x, z, y],
            [x, -z, -y],
          ])
          .concat([
            [0, 1, 0],
            [0, -1, 0],
          ])
      for (const [x, y, result] of table) {
        expect(await caller.divFix_(x, fp(y)), `divFix(${x}, ${y}) == ${result}`).to.equal(
          fp(result)
        )
      }
    })

    it('works for extreme results', async () => {
      // For cases that exercise the complicated path, we need:
      // 5.8e40 <= x < 5.8e76, fp(-3.14e39) <= y, result <= fp(3.14e39)
      const table = [
        [MAX_FIX_INT, fp(1), fp(MAX_FIX_INT)],
        [MAX_FIX_INT.sub(51), fp(1), fp(MAX_FIX_INT.sub(51))],
        [MAX_FIX_INT.mul(173), fp(173), fp(MAX_FIX_INT)],
        [MAX_INT192, fp('1e18'), MAX_INT192],
        [neg(MIN_INT192), fp('-1e18'), MIN_INT192],
        [bn('8e60'), fp('2e30'), fp('4e30')],
        [bn('5e75'), fp('2.5e39'), fp('2e36')],
        [bn('8e60'), fp('-2e30'), fp('-4e30')],
        [bn('5e75'), fp('-2.5e39'), fp('-2e36')],
      ]
      for (const [x, y, result] of table) {
        expect(await caller.divFix_(x, y), `divFix(${x}, ${y}) == ${result}`).to.equal(result)
      }
    })

    it('fails when results fall outside its range', async () => {
      await expect(caller.divFix_(MAX_INT192.add(1), fp(1))).to.be.reverted
      await expect(caller.divFix_(MAX_INT192.div(5), fp('0.199'))).to.be.reverted
    })
    it('fails on division by zero', async () => {
      await expect(caller.divFix_(17, fp(0))).to.be.reverted
      await expect(caller.divFix_(0, fp(0))).to.be.reverted
      await expect(caller.divFix_(MAX_INT192, fp(0))).to.be.reverted
      // we specifically expect panic code 0x12, but ethers seems to be choking on it
    })
  })

  describe('toInt', () => {
    it('correctly converts Fixes to int192', async () => {
      for (const result of fixable_ints) {
        expect(await caller.toInt(fp(result)), `fp(${result})`).to.equal(bn(result))
      }
    })
    it('correctly rounds towards zero', async () => {
      const table = [
        [1.1, 1],
        [-1.1, -1],
        [1.9, 1],
        [-1.9, -1],
        [1, 1],
        [0.1, 0],
        [-0.1, 0],
        [-1, -1],
        [705811305.5207, 705811305],
        [-6536585.939, -6536585],
        [MAX_FIX_INT, MAX_FIX_INT],
        [MIN_FIX_INT, MIN_FIX_INT],
        [9.99999, 9],
        [-9.99999, -9],
      ]
      for (const [input, result] of table) {
        expect(await caller.toInt(fp(input)), `${input}`).to.equal(result)
      }
    })
  })

  describe('shiftLeft', () => {
    it('mirrors the behavior of `toFixWithShift`', async () => {
      const table = [
        [0, 10],
        [1, 5],
        [1, -7],
        [2, 3],
        [2, -3],
        ['38326665875765560393', -10],
        ['38326665875', 9],
        [MAX_FIX_INT.sub(1), -2],
        [MAX_FIX_INT.sub(1), -1],
        [MAX_FIX_INT.sub(1), 0],
        [MAX_FIX_INT, -9],
        [MAX_FIX_INT, -1],
      ].map(([x, s]) => [bn(x), bn(s)])

      for (const [x, s] of table) {
        const xFix = await caller.toFix_(x)
        const a = await caller.shiftLeft(xFix, s)
        const b = await caller.toFixWithShift_(x, s)
        await expect(a, `toFix(${x}).shiftLeft(${s})`).to.equal(b)
      }
    })
  })

  describe('intRound', () => {
    it('correctly rounds to nearest int', async () => {
      // prettier-ignore
      const table = [
        [1.1, 1], [-1.1, -1], [1.9, 2], [-1.9, -2], [1, 1], [-1, -1], [0.1, 0],
        [705811305.5207, 705811306], [705811305.207, 705811305],
        [-6536585.939, -6536586], [-6536585.439, -6536585],
        [3.4999, 3], [-3.4999, -3], [3.50001, 4], [-3.50001, -4],
        [MAX_FIX_INT, MAX_FIX_INT], [MIN_FIX_INT, MIN_FIX_INT],
        [9.99999, 10], [-9.99999, -10],
        [6.5, 7], [5.5, 6], [-6.5, -7], [-5.5, -6],
        [0, 0], [0.5, 1], [-0.5, -1]
      ]
      for (const [input, result] of table) {
        expect(await caller.intRound(fp(input)), `fp(${input})`).to.equal(result)
      }
    })
  })

  describe('floor', () => {
    it('correctly converts positive Fixes to uint192', async () => {
      for (const result of fixable_ints) {
        if (result.gte(0)) {
          expect(await caller.floor(fp(result)), `fp(${result})`).to.equal(bn(result))
          expect(await caller.toUint(fp(result), RoundingApproach.FLOOR), `fp(${result})`).to.equal(
            bn(result)
          )
        }
      }
    })
    it('fails on negative Fixes', async () => {
      const table = [-1, fp(MIN_FIX_INT), MIN_INT192, fp(-986349)]
      for (const val of table) {
        await expect(caller.floor(val), `${val}`).to.be.revertedWith('IntOutOfBounds')
        await expect(caller.toUint(val, RoundingApproach.FLOOR), `${val}`).to.be.revertedWith(
          'IntOutOfBounds'
        )
      }
    })
    it('correctly rounds down', async () => {
      // prettier-ignore
      const table = [
        [1.1, 1],
        [1.9, 1],
        [1, 1],
        [0.1, 0],
        [705811305.5207, 705811305],
        [705811305.207, 705811305],
        [3.4999, 3],
        [3.50001, 3],
        [MAX_FIX_INT, MAX_FIX_INT],
        [9.99999, 9],
        [6.5, 6],
        [5.5, 5],
        [0, 0],
        [0.5, 0]
      ]
      for (const [input, result] of table) {
        expect(await caller.floor(fp(input)), `fp(${input})`).to.equal(result)
        expect(await caller.toUint(fp(input), RoundingApproach.FLOOR), `fp(${input})`).to.equal(
          result
        )
      }
    })
  })

  describe('round', () => {
    it('correctly rounds to nearest uint', async () => {
      // prettier-ignore
      const table = [
        [1.1, 1], [1.9, 2], [1, 1], [0.1, 0],
        [705811305.5207, 705811306], [705811305.207, 705811305],
        [3.4999, 3], [3.50001, 4],
        [MAX_FIX_INT, MAX_FIX_INT],
        [9.99999, 10],
        [6.5, 7], [5.5, 6],
        [0, 0], [0.5, 1]
      ]
      for (const [input, result] of table) {
        expect(await caller.round(fp(input)), `fp(${input})`).to.equal(result)
        expect(await caller.toUint(fp(input), RoundingApproach.ROUND), `fp(${input})`).to.equal(
          result
        )
      }
    })
  })

  describe('ceil', () => {
    it('correctly rounds up', async () => {
      // prettier-ignore
      const table = [
        [1.1, 2],
        [1.9, 2],
        [1, 1],
        [0.1, 1],
        [705811305.5207, 705811306],
        [705811305.207, 705811306],
        [3.4999, 4],
        [3.50001, 4],
        [MAX_FIX_INT, MAX_FIX_INT],
        [9.99999, 10],
        [6.5, 7],
        [5.5, 6],
        [0, 0],
        [0.5, 1]
      ]
      for (const [input, result] of table) {
        expect(await caller.ceil(fp(input)), `fp(${input})`).to.equal(result)
        expect(await caller.toUint(fp(input), RoundingApproach.CEIL), `fp(${input})`).to.equal(
          result
        )
      }
    })
  })

  describe('plus', () => {
    it('correctly adds in its range', async () => {
      const table_init = [
        [13, 25, 38],
        [0.1, 0.2, 0.3],
        [1, -1, 0],
        [5040, 301, 5341],
        [0, 0, 0],
        [0.1, -0.1, 0],
      ]
      const table = []
      for (const [a, b, c] of table_init) {
        table.push(
          [a, b, c],
          [-a, -b, -c],
          [b, a, c],
          [-b, -a, -c],
          [c, -a, b],
          [c, -b, a],
          [-c, a, -b],
          [-c, b, -a]
        )
      }
      table.push(
        ['1e-18', '2e-18', '3e-18'],
        [MAX_FIX_INT, 0, MAX_FIX_INT],
        [MAX_FIX_INT, MAX_FIX_INT.mul(-1), 0],
        [MAX_FIX_INT.div(8).mul(3), MAX_FIX_INT.div(8).mul(5), MAX_FIX_INT.div(8).mul(8)]
      )
      for (const [a, b, c] of table) {
        expect(await caller.plus(fp(a), fp(b)), `${a} + ${b}`).to.equal(fp(c))
      }
    })
    it('correctly adds at the extremes of its range', async () => {
      expect(await caller.plus(MAX_INT192, -1)).to.equal(MAX_INT192.sub(1))
      expect(await caller.plus(MAX_INT192.sub(1), 1)).to.equal(MAX_INT192)
      expect(await caller.plus(MIN_INT192.add(1), -1)).to.equal(MIN_INT192)
      expect(await caller.plus(MIN_INT192.div(2), MIN_INT192.div(2))).to.equal(MIN_INT192)
      expect(await caller.plus(MAX_INT192, MIN_INT192)).to.equal(-1)
    })
    it('fails outside its range', async () => {
      await expect(caller.plus(MAX_INT192, 1), 'plus(MAX, 1)').to.be.reverted
      const half_max = MAX_INT192.add(1).div(2)
      await expect(caller.plus(half_max, half_max), 'plus((MAX+1)/2, (MAX+1)/2)').to.be.reverted
      await expect(caller.plus(MIN_INT192, -1), 'plus(MIN, -1)').to.be.reverted
      await expect(
        caller.plus(MIN_INT192.div(2), MIN_INT192.div(2).sub(1)),
        'plus(MIN/2, MIN/2 -1)'
      ).to.be.reverted
    })
  })

  describe('plusu', () => {
    it('correctly adds in its range', async () => {
      const table = [
        [13, 25, 38],
        [25, 13, 38],
        [0.7, 0, 0.7],
        [5040, 301, 5341],
        [22, 96, 118],
        [0, 0, 0],
        [0.1, 3, 3.1],
        [-999.8, 999, -0.8],
      ]
      for (const [a, b, c] of table) {
        expect(await caller.plusu(fp(a), b), `plusu(${a}, ${b})`).to.equal(fp(c))
      }
    })

    it('correctly adds at the extremes of its range', async () => {
      expect(await caller.plusu(MAX_INT192.sub(SCALE.mul(3)), 3), 'plusu(MAX-3, 3)').to.equal(
        MAX_INT192
      )
      const max_mantissa = MAX_INT192.mod(SCALE)
      expect(
        await caller.plusu(max_mantissa.sub(fp(12345)), MAX_FIX_INT.add(12345)),
        'plusu(max_mantissa - 12345, MAX_FIX_INT + 12345)'
      ).to.equal(MAX_INT192)

      expect(await caller.plusu(MIN_INT192, 0), 'plusu(MIN, 0)').to.equal(MIN_INT192)
    })

    it('fails outside its range', async () => {
      await expect(caller.plusu(MAX_INT192.sub(SCALE.mul(3)).add(1), 3), 'plusu(MAX-3+eps, 3)').to
        .be.reverted
      await expect(caller.plusu(MAX_INT192.sub(SCALE.mul(3)), 4), 'plusu(MAX-3, 4)').to.be.reverted
      await expect(caller.plusu(0, MAX_FIX_INT.add(1)), 'plusu(0, MAX_FIX + 1)').to.be.reverted
      await expect(caller.plusu(0, MAX_UINT192), 'plusu(0, MAX_UINT)').to.be.reverted
    })
  })

  describe('minus', () => {
    it('correctly subtracts in its range', async () => {
      const table_init = [
        [13, -25, 38],
        [0.1, -0.2, 0.3],
        [1, 1, 0],
        [5040, -301, 5341],
        [0, 0, 0],
        [0.1, 0.1, 0],
      ]
      const table = []
      for (const [a, b, c] of table_init) {
        table.push(
          [a, b, c],
          [-a, -b, -c],
          [b, a, -c],
          [-b, -a, c],
          [a, c, b],
          [-a, -c, -b],
          [c, a, -b],
          [-c, -a, b]
        )
      }
      table.push(
        ['3e-18', '2e-18', '1e-18'],
        [MAX_FIX_INT, 0, MAX_FIX_INT],
        [MAX_FIX_INT, MAX_FIX_INT, 0],
        [MAX_FIX_INT.div(8).mul(5), MAX_FIX_INT.div(8).mul(-3), MAX_FIX_INT.div(8).mul(8)]
      )
      for (const [a, b, c] of table) {
        expect(await caller.minus(fp(a), fp(b)), `${a} + ${b}`).to.equal(fp(c))
      }
    })
    it('correctly subtracts at the extremes of its range', async () => {
      expect(await caller.minus(MAX_INT192, 1)).to.equal(MAX_INT192.sub(1))
      expect(await caller.minus(MAX_INT192.sub(1), -1)).to.equal(MAX_INT192)
      expect(await caller.minus(MIN_INT192.add(1), 1)).to.equal(MIN_INT192)
      expect(await caller.minus(MIN_INT192.div(2), MIN_INT192.div(2).mul(-1))).to.equal(MIN_INT192)
      expect(await caller.minus(MAX_INT192, MAX_INT192)).to.equal(0)
      expect(await caller.minus(MIN_INT192, MIN_INT192)).to.equal(0)
    })
    it('fails outside its range', async () => {
      await expect(caller.minus(MAX_INT192, -1), 'minus(MAX, -1)').to.be.reverted
      const half_max = MAX_INT192.add(1).div(2)
      await expect(caller.minus(half_max, half_max.mul(-1)), 'minus((MAX+1)/2, -(MAX+1)/2)').to.be
        .reverted
      await expect(caller.minus(MIN_INT192, 1), 'minus(MIN, 1)').to.be.reverted
      const half_min = MIN_INT192.div(2)
      await expect(caller.minus(half_min, half_min.sub(1).mul(-1)), 'minus(MIN/2, -MIN/2 +1)').to.be
        .reverted
    })
  })

  describe('minusu', () => {
    it('correctly subtracts in its range', async () => {
      const table = [
        [38, 25, 13],
        [38, 13, 25],
        [0.7, 0, 0.7],
        [5342, 301, 5041],
        [118, 96, 22],
        [0, 0, 0],
        [999.8, 999, 0.8],
        [-1000, 234, -1234],
        [5, 12, -7],
      ]
      for (const [a, b, c] of table) {
        expect(await caller.minusu(fp(a), b), `minusu(${a}, ${b})`).to.equal(fp(c))
      }
    })
    it('correctly subtracts at the extremes of its range', async () => {
      expect(
        await caller.minusu(MIN_INT192.add(SCALE.mul(81)), 81),
        'minusu(MIN + 81, 81)'
      ).to.equal(MIN_INT192)
      expect(await caller.minusu(MAX_INT192, 0), 'minusu(MAX, 0)').to.equal(MAX_INT192)
      expect(await caller.minusu(MIN_INT192, 0), 'minusu(MIN, 0)').to.equal(MIN_INT192)
    })

    it('fails outside its range', async () => {
      await expect(caller.minusu(MAX_INT192, MAX_FIX_INT.mul(2).add(3)), 'minusu(MAX, MAX_FIX*2+3)')
        .to.be.reverted
      await expect(caller.minusu(MIN_INT192, 1), 'minusu(MIN, 1)').to.be.reverted
      await expect(caller.minusu(0, MAX_FIX_INT.add(1)), 'minusu(0, MAX_FIX + 1)').to.be.reverted
      await expect(caller.minusu(0, MAX_UINT192), 'minusu(0, MAX_UINT)').to.be.reverted
    })
  })

  // mulu_table: numeric triples where a * b == c, and b is a positive integer
  const mulu_table = [
    [1, 1, 1],
    [0.763, 1, 0.763],
    [3.4, 7, 23.8],
    [0.001, 1000, 1],
    [1.001, 999, 999.999],
    [12, 13, 156],
  ]
  describe('mul', () => {
    it('correctly multiplies inside its range', async () => {
      const commutes = mulu_table.flatMap(([a, b, c]) => [
        [a, b, c],
        [b, a, c],
      ])
      const table = commutes.flatMap(([a, b, c]) => [
        [a, b, c],
        [-a, b, -c],
        [a, -b, -c],
        [-a, -b, c],
      ])
      for (const [a, b, c] of table) {
        expect(await caller.mul(fp(a), fp(b)), `mul(fp(${a}), fp(${b}))`).to.equal(fp(c))
      }
    })
    it('rounds results as intended', async () => {
      expect(await caller.mul(fp('0.5e-9'), fp('1e-9'))).to.equal(fp('1e-18'))
      expect(await caller.mul(fp('-0.5e-9'), fp('1e-9'))).to.equal(fp('-1e-18'))
      expect(await caller.mul(fp('0.5e-9'), fp('-1e-9'))).to.equal(fp('-1e-18'))
      expect(await caller.mul(fp('-0.5e-9'), fp('-1e-9'))).to.equal(fp('1e-18'))
      expect(await caller.mul(fp('0.49e-9'), fp('1e-9'))).to.equal(fp('0'))
      expect(await caller.mul(fp('-0.49e-9'), fp('1e-9'))).to.equal(fp('0'))
      expect(await caller.mul(fp('0.49e-9'), fp('-1e-9'))).to.equal(fp('0'))
      expect(await caller.mul(fp('-0.49e-9'), fp('-1e-9'))).to.equal(fp('0'))
      expect(await caller.mul(fp('1.5e-9'), fp('4.5e-8'))).to.equal(fp('68e-18'))
    })
    it('correctly multiplies at the extremes of its range', async () => {
      const table = [
        [MAX_INT192, fp(1), MAX_INT192],
        [MIN_INT192, fp(1), MIN_INT192],
        [MIN_INT192.div(256), fp(256), MIN_INT192],
        [MAX_INT192.sub(1).div(2), fp(2), MAX_INT192.sub(1)],
        [MAX_INT192, fp(-1), MIN_INT192.add(1)],
      ]
      for (const [a, b, c] of table) {
        expect(await caller.mul(a, b), `mul(${a}, ${b})`).to.equal(c)
        expect(await caller.mul(b, a), `mul(${b}, ${a})`).to.equal(c)
      }
    })
    it('fails outside its range', async () => {
      await expect(caller.mul(MIN_INT192, fp(-1)), 'mul(MIN, -1)').to.be.reverted
      await expect(caller.mul(MAX_INT192.div(2).add(1), fp(2)), 'mul(MAX/2 + 2, 2)').to.be.reverted
      await expect(caller.mul(fp(bn(2).pow(81)), fp(bn(2).pow(81))), 'mul(2^81, 2^81)').to.be
        .reverted
      await expect(caller.mul(fp(bn(2).pow(81).mul(-1)), fp(bn(2).pow(81))), 'mul(-2^81, 2^81)').to
        .be.reverted
    })
  })

  describe('mulu', () => {
    it('correctly multiplies inside its range', async () => {
      const table = mulu_table.flatMap(([a, b, c]) => [
        [a, b, c],
        [-a, b, -c],
      ])
      for (const [a, b, c] of table) {
        expect(await caller.mulu(fp(a), b), `mulu(fp(${a}), ${b})`).to.equal(fp(c))
      }
    })
    it('correctly multiplies at the extremes of its range', async () => {
      const table = [
        [MAX_INT192, 1, MAX_INT192],
        [MIN_INT192, 1, MIN_INT192],
        [fp(1), MAX_FIX_INT, fp(MAX_FIX_INT)],
        [MIN_INT192.div(256), 256, MIN_INT192],
        [MAX_INT192.sub(1).div(2), 2, MAX_INT192.sub(1)],
        [fp(0.25), bn(2).pow(69), fp(bn(2).pow(67))],
      ]
      for (const [a, b, c] of table) expect(await caller.mulu(a, b), `mulu(${a}, ${b})`).to.equal(c)
    })
    it('fails outside its range', async () => {
      const table = [
        [MAX_INT192.div(2).add(1), 2],
        [fp(bn(2).pow(68)), bn(2).pow(68)],
        [MAX_INT192, MAX_INT192],
        [MIN_INT192, MAX_INT192],
        [fp(1), MAX_UINT192],
        [fp(0.25), bn(2).pow(195)],
      ]
      for (const [a, b] of table) {
        await expect(caller.mulu(a, b), `mulu(${a}, ${b})`).to.be.reverted
      }
    })
  })
  describe('div', () => {
    it('correctly divides inside its range', async () => {
      // prettier-ignore
      const table: BigNumber[][] = [
        [fp(100), fp(20), fp(5)],
        [fp(1.0), fp(25), fp(0.04)],
        [bn(50), fp(50), bn(1)],
        [bn(2), bn(2), fp(1)],
        [bn(3), bn(2), fp(1.5)],
        [fp(1), bn(1), fp('1e18')],
        [bn(1), fp(1), bn(1)]
      ].flatMap(([a, b, c]) => [[a, b, c], [a, c, b]])
        .flatMap(([a, b, c]) => [[a, b, c], [neg(a), b, neg(c)]])
        .flatMap(([a, b, c]) => [[a, b, c], [a, neg(b), neg(c)]])

      for (const [a, b, c] of table) {
        expect(await caller.div(a, b), `div(${a}, ${b})`).to.equal(c)
      }
    })
    it('correctly divides at the extremes of its range', async () => {
      // prettier-ignore
      const table: BigNumber[][] = [
        [MAX_INT192, fp(1), MAX_INT192],
        [MAX_INT192, fp(-1), neg(MAX_INT192)],
        [MIN_INT192, fp(2), MIN_INT192.div(2)]
      ].flatMap(([a, b, c]) => [[a, b, c], [a, c, b]])

      for (const [a, b, c] of table) {
        expect(await caller.div(a, b), `div((${a}, ${b})`).to.equal(c)
      }
    })
    it('correctly truncates results (towards zero)', async () => {
      const table = [
        [bn(5), fp(2), bn(2)],
        [bn(-5), fp(2), bn(-2)],
        [bn(29), fp(10), bn(2)],
        [bn(-19), fp(10), bn(-1)],
      ]

      for (const [a, b, c] of table) {
        expect(await caller.div(a, b), `div((${a}, ${b})`).to.equal(c)
      }
    })
    it('fails outside its range', async () => {
      // prettier-ignore
      const table: BigNumber[][] = [
        [MAX_INT192, fp(0.99)],
        [MAX_INT192.div(5), fp(0.19)],
        [MAX_INT192.div(pow10(16)), bn(1)],
        [MIN_INT192, fp(0.99)],
        [MIN_INT192.div(5), fp(0.19)],
        [MIN_INT192.div(pow10(16)), bn(1)]
      ].flatMap(([a, b]) => [[a, b], [a, neg(b)]])

      for (const [a, b] of table) {
        await expect(caller.div(a, b), `div((${a}, ${b})`).to.be.reverted
      }
    })
    it('fails to divide by zero', async () => {
      // prettier-ignore
      const table =
        [fp(1), fp(MAX_INT192), fp(MIN_INT192), fp(0), fp(-1), bn(1), bn(-1), bn(987162349587)]

      for (const x of table) {
        await expect(caller.div(x, bn(0)), `div(${x}, 0`).to.be.reverted
      }
    })
  })
  describe('divu', () => {
    it('correctly divides inside its range', async () => {
      // prettier-ignore
      const table = [
        [fp(100), bn(20), fp(5)],
        [fp(1.0), bn(25), fp(0.04)],
        [bn(50), bn(50), bn(1)],
        [fp(2), bn(2), fp(1)],
        [fp(3), bn(2), fp(1.5)],
        [fp(1), bn(1), fp(1)],
        [bn(1), bn(1), bn(1)]
      ]

      for (const [a, b, c] of table) {
        expect(await caller.divu(a, b), `divu((${a}, ${b})`).to.equal(c)
      }
    })
    it('correctly divides at the extremes of its range', async () => {
      // prettier-ignore
      const table = [
        [MAX_INT192, bn(1), MAX_INT192],
        [MIN_INT192, bn(1), MIN_INT192],
        [MIN_INT192, bn(2), MIN_INT192.div(2)]
      ]

      for (const [a, b, c] of table) {
        expect(await caller.divu(a, b), `divu(${a}, ${b})`).to.equal(c)
      }
    })
    it('correctly truncates results towards zero', async () => {
      // prettier-ignore
      const table = [
        [bn(5), bn(2), bn(2)],
        [bn(-5), bn(2), bn(-2)],
        [bn(29), bn(10), bn(2)],
        [bn(-19), bn(10), bn(-1)]
      ]

      for (const [a, b, c] of table) {
        expect(await caller.divu(a, b), `divu((${a}, ${b})`).to.equal(c)
      }
    })
    it('fails to divide by zero', async () => {
      // prettier-ignore
      const table = [fp(1), fp(0), fp(-1), bn(1), bn(-1),
                     bn(987162349587), fp(MAX_INT192), fp(MIN_INT192),]

      for (const x of table) {
        await expect(caller.divu(x, bn(0)), `divu(${x}, 0`).to.be.reverted
      }
    })
  })
  describe('divuRound', () => {
    it('correctly divides inside its range', async () => {
      // prettier-ignore
      const table = [
        [fp(100), bn(20), fp(5)],
        [fp(1.0), bn(25), fp(0.04)],
        [bn(50), bn(50), bn(1)],
        [fp(2), bn(2), fp(1)],
        [fp(3), bn(2), fp(1.5)],
        [fp(1), bn(1), fp(1)],
        [bn(1), bn(1), bn(1)]
      ]

      for (const [a, b, c] of table) {
        expect(await caller.divuRound(a, b), `divuRound((${a}, ${b})`).to.equal(c)
      }
    })
    it('correctly divides at the extremes of its range', async () => {
      // prettier-ignore
      const table = [
        [MAX_INT192, bn(1), MAX_INT192],
        [MIN_INT192, bn(1), MIN_INT192],
        [MIN_INT192, bn(2), MIN_INT192.div(2)]
      ]
      for (const [a, b, c] of table) {
        expect(await caller.divuRound(a, b), `divuRound(${a}, ${b})`).to.equal(c)
      }
    })
    it('correctly rounds results towards the nearest output fix', async () => {
      // prettier-ignore
      const table = [
        [bn(7), bn(3), bn(2)],
        [bn(5), bn(3), bn(2)],
        [bn(-5), bn(3), bn(-2)],
        [bn(0), bn(1), bn(0)],
        [bn(25), bn(10), bn(3)],
        [bn(29), bn(10), bn(3)],
        [bn(30), bn(10), bn(3)],
        [bn(31), bn(10), bn(3)],
        [bn(34), bn(10), bn(3)],
        [bn(-25), bn(10), bn(-3)],
        [bn(-29), bn(10), bn(-3)],
        [bn(-30), bn(10), bn(-3)],
        [bn(-31), bn(10), bn(-3)],
        [bn(-34), bn(10), bn(-3)]
      ]
      for (const [a, b, c] of table) {
        expect(await caller.divuRound(a, b), `divuRound((${a}, ${b})`).to.equal(c)
      }
    })
    it('fails to divide by zero', async () => {
      // prettier-ignore
      const table = [fp(1), fp(0), fp(-1), bn(1), bn(-1),
                     fp(MAX_INT192), fp(MIN_INT192), bn(987162349587)]

      for (const x of table) {
        await expect(caller.divuRound(x, bn(0)), `divuRound(${x}, 0`).to.be.reverted
      }
    })
  })
  describe('inv', () => {
    it('correctly inverts inside its range', async () => {
      // prettier-ignore
      const table = [
        [fp(1), fp(1)],
        [fp(2), fp(0.5)],
        [bn(2), fp('0.5e18')],
        [bn(1e9), fp(1e9)]
      ].flatMap(([a, b]) => [[a, b], [b, a], [neg(a), neg(b)], [neg(b), neg(a)]])

      for (const [a, b] of table) {
        expect(await caller.inv(a), `inv(${a})`).to.equal(b)
      }
    })
    it('correctly inverts at the extremes of its range', async () => {
      // prettier-ignore
      const table = [
        [MAX_INT192, 0],
        [MIN_INT192, 0],
        [fp('1e18'), bn(1)],
        [fp('-1e18'), bn(-1)],
        [bn(1), fp('1e18')],
        [bn(-1), fp('-1e18')]
      ]

      for (const [a, b] of table) {
        expect(await caller.inv(a), `inv(${a})`).to.equal(b)
      }
    })
    it('fails to invert zero', async () => {
      await expect(caller.inv(bn(0))).to.be.reverted
    })
  })
  describe('powu', () => {
    it('correctly exponentiates inside its range', async () => {
      // prettier-ignore
      const table = [
        [fp(1.0), bn(1), fp(1.0)],
        [fp(1.0), bn(15), fp(1.0)],
        [fp(2), bn(7), fp(128)],
        [fp(2), bn(63), fp('9223372036854775808')],
        [fp(2), bn(64), fp('18446744073709551616')],
        [fp(1.5), bn(7), fp(17.0859375)],
        [fp(-1), bn(2), fp(1)],
        [fp(-1), MAX_UINT192, fp(-1)],
        [fp(-1), MAX_UINT192.sub(1), fp(1)],
        [fp(1.1), bn(4), fp('1.4641')],
        [fp(1.1), bn(5), fp('1.61051')],
        [fp(0.23), bn(3), fp('0.012167')],
        [bn(1), bn(2), bn(0)],
        [fp('1e-9'), bn(2), fp('1e-18')],
        [fp(0.1), bn(17), fp('1e-17')],
        [fp(10), bn(19), fp('1e19')]
      ]

      for (const [a, b, c] of table) {
        expect(await caller.powu(a, b), `powu(${a}, ${b})`).to.equal(c)
      }
    })
    it('correctly exponentiates at the extremes of its range', async () => {
      const table = [
        [MAX_INT192, bn(1), MAX_INT192],
        [MIN_INT192, bn(1), MIN_INT192],
        [MIN_INT192, bn(0), fp(1)],
        [fp(0), bn(0), fp(1.0)],
        [fp(987.0), bn(0), fp(1.0)],
        [fp(1.0), bn(2).pow(256).sub(1), fp(1.0)],
        [fp(-1.0), bn(2).pow(256).sub(1), fp(-1.0)],
        [fp(2), bn(131), fp(bn(2).pow(131))],
      ]

      for (const [a, b, c] of table) {
        expect(await caller.powu(a, b), `powu(${a}, ${b})`).to.equal(c)
      }
    })
    it('fails outside its range', async () => {
      const table = [
        [fp(10), bn(40)],
        [fp(-10), bn(40)],
        [MAX_INT192, bn(2)],
        [MIN_INT192, bn(2)],
        [fp('8e19'), bn(2)],
        [fp('1.9e13'), bn(3)],
        [fp('9e9'), bn(4)],
        [fp('9.2e8'), bn(5)],
        [fp(2), bn(191)],
      ]

      for (const [a, b] of table) {
        await expect(caller.powu(a, b), `powu(${a}, ${b})`).to.be.reverted
      }
    })
  })

  describe('increment', () => {
    it('increments the whole numbers', async () => {
      const table = [0, 864, 1e15]
      for (const a of table) {
        expect(await caller.increment(fp(a)), `increment(${a})`).to.equal(fp(a).add(1))
      }
    })

    it('increments the negative numbers', async () => {
      const table = [-1, -864, -1e15]
      for (const a of table) {
        expect(await caller.increment(fp(a)), `increment(${a})`).to.equal(fp(a).add(1))
      }
    })

    it('fails at max', async () => {
      await expect(caller.increment(MAX_INT192), `increment(${MAX_INT192})`).to.be.reverted
    })
  })

  describe('lt', () => {
    it('correctly evaluates <', async () => {
      for (const a of int192s)
        for (const b of int192s) {
          expect(await caller.lt(a, b), `lt(${a}, ${b})`).to.equal(a.lt(b))
        }
    })
  })
  describe('lte', () => {
    it('correctly evaluates <=', async () => {
      for (const a of int192s)
        for (const b of int192s) {
          expect(await caller.lte(a, b), `lte(${a}, ${b})`).to.equal(a.lte(b))
        }
    })
  })
  describe('gt', () => {
    it('correctly evaluates >', async () => {
      for (const a of int192s)
        for (const b of int192s) expect(await caller.gt(a, b), `gt(${a}, ${b})`).to.equal(a.gt(b))
    })
  })
  describe('gte', () => {
    it('correctly evaluates >=', async () => {
      for (const a of int192s)
        for (const b of int192s)
          expect(await caller.gte(a, b), `gte(${a}, ${b})`).to.equal(a.gte(b))
    })
  })
  describe('eq', () => {
    it('correctly evaluates ==', async () => {
      for (const a of int192s)
        for (const b of int192s) expect(await caller.eq(a, b), `eq(${a}, ${b})`).to.equal(a.eq(b))
    })
  })
  describe('neq', () => {
    it('correctly evaluates !=', async () => {
      for (const a of int192s)
        for (const b of int192s)
          expect(await caller.neq(a, b), `neq(${a}, ${b})`).to.equal(!a.eq(b))
    })
  })
  describe('fixMin', () => {
    it('correctly evaluates min', async () => {
      for (const a of int192s)
        for (const b of int192s)
          expect(await caller.fixMin_(a, b), `fixMin(${a}, ${b})`).to.equal(a.lt(b) ? a : b)
    })
  })
  describe('fixMax', () => {
    it('correctly evaluates max', async () => {
      for (const a of int192s)
        for (const b of int192s)
          expect(await caller.fixMax_(a, b), `fixMax(${a}, ${b})`).to.equal(a.gt(b) ? a : b)
    })
  })

  describe('near', () => {
    it('correctly evaluates approximate equality', async () => {
      const table = [
        [fp(0), fp(0.1), fp(0.10001)],
        [fp(1), fp('1.00001'), fp('0.00001')],
        [fp(1), fp('1.000014'), fp('0.00001')],
        [fp(1), fp('1.000007'), fp('0.00001')],
        [fp(1), fp('1.00001'), fp('0.000010001')],
        [bn(87654), bn(87654), bn(1)],
        [bn(87654), bn(87655), bn(1)],
        [bn(87654), bn(87655), bn(2)],
        [fp(1.0), fp(1.0), bn(1)],
      ].flatMap(([a, b, c]) => [
        [a, b, c],
        [b, a, c],
        [neg(a), neg(b), c],
        [neg(b), neg(a), c],
      ])

      for (const [a, b, c] of table) {
        expect(await caller.near(a, b, c), `near(${a}, ${b}, ${c}`).to.equal(a.sub(b).abs().lt(c))
      }
    })

    it('correctly evaluates approximate equality at the extremes of its range', async () => {
      const table = [
        [MAX_INT192, MAX_INT192, bn(1)],
        [MAX_INT192, MIN_INT192, bn(1)],
        [MIN_INT192, MAX_INT192, bn(1)],
        [MIN_INT192, MIN_INT192, bn(1)],

        [MAX_INT192, MAX_INT192.sub(1), bn(1)],
        [MAX_INT192, MAX_INT192.sub(1), bn(2)],
        [MIN_INT192, MIN_INT192.add(1), bn(1)],
        [MIN_INT192, MIN_INT192.add(1), bn(2)],
        [bn(-1000), MIN_INT192, MAX_INT192],
        [bn(1000), MAX_INT192, MAX_INT192],
      ].flatMap(([a, b, c]) => [
        [a, b, c],
        [b, a, c],
      ])

      for (const [a, b, c] of table) {
        expect(await caller.near(a, b, c), `near(${a}, ${b}, ${c}`).to.equal(a.sub(b).abs().lt(c))
      }
    })
  })

  describe.only('fullMul', () => {
    const m = MAX_INT256
    const table = [
      [0, 0],
      [0, 1],
      [1, 1],
      [48763, 875123],
      [m, m],
      [m.sub(1), m.sub(17)],
    ].map(([x, y]) => [bn(x), bn(y)])

    const WORD = bn(2).pow(256)
    for (const [x, y] of table) {
      it(`multiplies ${x} and ${y}`, async () => {
        const prod = x.mul(y)
        const loExpected = prod.mod(WORD)
        const hiExpected = prod.div(WORD)
        const [loResult, hiResult] = await caller.fullMul_(x, y)
        expect(hiResult).to.equal(hiExpected)
        expect(loResult).to.equal(loExpected)
      })
    }
  })

  describe.only('mulDiv', () => {
    const m = MAX_INT256
    const table = [
      [0, 0],
      [0, 1],
      [1, 1],
      [48763, 875123],
      [m, m],
      [m.sub(1), m.sub(17)],
    ].map(([x, y]) => [bn(x), bn(y)])

    const WORD = bn(2).pow(256)
    for (const [x, y] of table) {
      it(`multiplies ${x} and ${y}`, async () => {
        const prod = x.mul(y)
        const loExpected = prod.mod(WORD)
        const hiExpected = prod.div(WORD)
        const [loResult, hiResult] = await caller.fullMul_(x, y)
        expect(hiResult).to.equal(hiExpected)
        expect(loResult).to.equal(loExpected)
      })
    }
  })
})
