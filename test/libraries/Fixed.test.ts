import { expect } from 'chai'
import { ContractFactory, BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import fc from 'fast-check'

import { BN_SCALE_FACTOR } from '../../common/constants'
import { bn, fp, pow10, fpCeil, fpFloor, fpRound, div, shortString } from '../../common/numbers'
import { FixedCallerMock } from '../../typechain/FixedCallerMock'

enum RoundingMode {
  FLOOR,
  ROUND,
  CEIL,
}

const FLOOR = RoundingMode.FLOOR
const ROUND = RoundingMode.ROUND
const CEIL = RoundingMode.CEIL
const ROUNDING_MODES = [
  [FLOOR, 'FLOOR'],
  [ROUND, 'ROUND'],
  [CEIL, 'CEIL'],
]

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

  // prettier-ignore
  const positive_int192s: BigNumber[] = [
    bn(1), fp(0.9999), fp(1), fp(1.0001), MAX_INT192.sub(1), MAX_INT192
  ]
  const negative_int192s = positive_int192s.map(neg)
  negative_int192s.reverse()

  const int192s: BigNumber[] = [MIN_INT192, ...negative_int192s, bn(0), ...positive_int192s]

  const int192Pairs: [BigNumber, BigNumber][] = int192s.slice(1).map((val, i) => [int192s[i], val])

  // This is before() instead of beforeEach():
  // All of these functions are pure, so the contract state can be reused.
  before(async () => {
    FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  describe('toFix(uint)', () => {
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

  describe('shiftl_toFix', () => {
    it('correctly converts uint values with 0 shifting', async () => {
      const table = [0, 1, 2, '38326665875765560393', MAX_FIX_INT.sub(1), MAX_FIX_INT].map(bn)
      for (const x of table) {
        expect(await caller.shiftl_toFix_(x, bn(0)), `${x}`).to.equal(fp(x))
        expect(await caller.shiftl_toFix_Rnd(x, bn(0), FLOOR), `${x}`).to.equal(fp(x))
        expect(await caller.shiftl_toFix_Rnd(x, bn(0), CEIL), `${x}`).to.equal(fp(x))
        expect(await caller.shiftl_toFix_Rnd(x, bn(0), ROUND), `${x}`).to.equal(fp(x))
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
        expect(await caller.shiftl_toFix_(x, s), `shiftl_toFix(${x}, ${s})`).to.equal(
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
        await expect(caller.shiftl_toFix_(x, s), `toFix(${x}, ${s})`).to.be.reverted
        await expect(caller.shiftl_toFix_Rnd(x, s, FLOOR), `toFix(${x}, ${s}, FLOOR)`).be.reverted
      }
    })
    it('handles rounding', async () => {
      const table = [
        [0, -1],
        [0, -19],
        [1, -1],
        [1, -19],
        ['38326665875765560393', -19],
        ['38326665875', -10],
        [MAX_FIX_INT.sub(1), -1],
        [MAX_FIX_INT.sub(1), -19],
        [MAX_FIX_INT.sub(1), 0],
        [MAX_FIX_INT, -1],
        [MAX_FIX_INT, -19],
      ].map(([x, s]) => [bn(x), bn(s)])

      for (const [x, s] of table) {
        const fixed = fp(x)
          .mul(SCALE)
          .div(pow10(neg(s)))
        expect(
          await caller.shiftl_toFix_Rnd(x, s, FLOOR),
          `shiftl_toFix(${x}, ${s}, FLOOR)`
        ).to.equal(fpFloor(fixed).div(SCALE))
        expect(
          await caller.shiftl_toFix_Rnd(x, s, ROUND),
          `shiftl_toFix(${x}, ${s}, ROUND)`
        ).to.equal(fpRound(fixed).div(SCALE))
        expect(
          await caller.shiftl_toFix_Rnd(x, s, CEIL),
          `shiftl_toFix(${x}, ${s}, CEIL)`
        ).to.equal(fpCeil(fixed).div(SCALE))
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
        const a: BigNumber = bn(x)
        const b: BigNumber = fp(y)
        const c: BigNumber = fp(result)
        expect(await caller.divFix_(a, b), `divFix(${x}, ${y}) == ${result}`).to.equal(c)
      }
    })

    describe('works for extreme results', () => {
      // For cases that exercise the complicated path, we need:
      // 5.8e40 <= x < 5.8e76, fp(-3.14e39) <= y, result <= fp(3.14e39)
      const table = [
        [MAX_FIX_INT, fp(1), fp(MAX_FIX_INT)],
        [MAX_FIX_INT.sub(51), fp(1), fp(MAX_FIX_INT.sub(51))],
        [MAX_FIX_INT.mul(173), fp(173), fp(MAX_FIX_INT)],
        [MAX_INT192, fp('1e18'), MAX_INT192],
        [MAX_INT192, fp('-1e18'), neg(MAX_INT192)],
        [bn('8e60'), fp('2e30'), fp('4e30')],
        [bn('5e75'), fp('2.5e39'), fp('2e36')],
        [bn('8e60'), fp('-2e30'), fp('-4e30')],
        [bn('5e75'), fp('-2.5e39'), fp('-2e36')],
      ]
      for (const [x, y, result] of table) {
        it(`divFix(${x}, ${y}) == ${result}`, async () => {
          expect(await caller.divFix_(x, y)).to.equal(result)
        })
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
  describe('fixMin', () => {
    it('correctly evaluates min', async () => {
      for (const [a, b] of int192Pairs)
        expect(await caller.fixMin_(a, b), `fixMin(${a}, ${b})`).to.equal(a.lt(b) ? a : b)
    })
  })
  describe('fixMax', () => {
    it('correctly evaluates max', async () => {
      for (const [a, b] of int192Pairs)
        expect(await caller.fixMax_(a, b), `fixMax(${a}, ${b})`).to.equal(a.gt(b) ? a : b)
    })
  })
  describe('signOf', () => {
    it('correctly takes signOf', async () => {
      // prettier-ignore
      const table = [
        [bn(0), 1],
        [bn(1), 1],
        [bn(-1), -1],
        [MAX_FIX_INT, 1],
        [MIN_FIX_INT, -1],
        [MAX_FIX_INT.sub(1), 1],
        [MIN_FIX_INT.add(1), -1],
        [bn('38326665875765560393'), 1],
        [bn('-01942957121544002253'), -1],
      ]
      for (const [input, result] of table) {
        expect(await caller.signOf_(input), `signOf(${input})`).to.equal(result)
      }
    })
  })
  describe('abs', () => {
    it('correctly takes abs', async () => {
      // prettier-ignore
      const table = [
        [bn(0), 0],
        [bn(1), 1],
        [bn(-1), 1],
        [MAX_FIX_INT, MAX_FIX_INT],
        [MIN_FIX_INT, MAX_FIX_INT],
        [MAX_FIX_INT.sub(1), MAX_FIX_INT.sub(1)],
        [MIN_FIX_INT.add(1), MAX_FIX_INT.sub(1)],
        [bn('38326665875765560393'), bn('38326665875765560393')],
        [bn('-01942957121544002253'), bn('01942957121544002253')],
      ]
      for (const [input, result] of table) {
        expect(await caller.abs_(input), `abs(${input})`).to.equal(result)
      }
    })
  })
  describe('_divrnd(int, int, RoundingMode)', () => {
    it('correctly rounds', async () => {
      const table = [
        [fp(5), fp(2)],
        [fp(-5), fp(2)],
        [fp(29), fp(10)],
        [fp(-29), fp(10)],
        [fp(19), fp(10)],
        [fp(-19), fp(10)],
      ]

      for (const [a, b] of table) {
        const floor = fpFloor(a.mul(SCALE).div(b)).div(SCALE)
        const round = fpRound(a.mul(SCALE).div(b)).div(SCALE)
        const ceil = fpCeil(a.mul(SCALE).div(b)).div(SCALE)
        expect(await caller.divrnd_(a, b, FLOOR), `divrnd_((${a}, ${b}, FLOOR)`).to.equal(floor)
        expect(await caller.divrnd_(a, b, ROUND), `divrnd_((${a}, ${b}, ROUND)`).to.equal(round)
        expect(await caller.divrnd_(a, b, CEIL), `divrnd_((${a}, ${b}, CEIL)`).to.equal(ceil)
      }
    })
    describe('does what I expect with signs', () => {
      function item(n: string, d: string, rnd: RoundingMode, result: string) {
        it(`_divrnd(${n},${d},${RoundingMode[rnd]}) = ${result}`, async () => {
          expect(await caller.divrnd_(bn(n), bn(d), rnd)).to.equal(bn(result))
        })
      }
      item('1e18', '-1', RoundingMode.FLOOR, '-1e18')
      item('1e18', '-1', RoundingMode.ROUND, '-1e18')
      item('1e18', '-1', RoundingMode.CEIL, '-1e18')
      item('1e18', '-2', RoundingMode.FLOOR, '-0.5e18')
      item('1e18', '-2', RoundingMode.ROUND, '-0.5e18')
      item('1e18', '-2', RoundingMode.CEIL, '-0.5e18')
      item('-5e17', '1e18', RoundingMode.ROUND, '-1')
    })
  })
  describe('_divrnd(uint, uint, RoundingMode)', () => {
    it('correctly rounds', async () => {
      const table = [
        [bn(5), bn(2)],
        [bn(29), bn(10)],
        [bn(19), bn(10)],
      ]

      for (const [a, b] of table) {
        const floor = fpFloor(a.mul(SCALE).div(b)).div(SCALE)
        const round = fpRound(a.mul(SCALE).div(b)).div(SCALE)
        const ceil = fpCeil(a.mul(SCALE).div(b)).div(SCALE)
        expect(await caller.divrnd_u(a, b, FLOOR), `divrnd_u((${a}, ${b}, FLOOR)`).to.equal(floor)
        expect(await caller.divrnd_u(a, b, ROUND), `divrnd_u((${a}, ${b}, ROUND)`).to.equal(round)
        expect(await caller.divrnd_u(a, b, CEIL), `divrnd_u((${a}, ${b}, CEIL)`).to.equal(ceil)
      }
    })
  })

  describe('toUint + toUintRnd', () => {
    it('correctly rounds', async () => {
      // prettier-ignore
      const table = [
        1.1,
        1.9,
        1,
        0.1,
        705811305.5207,
        705811305.207,
        3.4999,
        3.50001,
        MAX_FIX_INT,
        9.99999,
        6.5,
        5.5,
        0,
        0.5
      ]
      for (const input of table) {
        const floor = fpFloor(fp(input)).div(SCALE)
        const round = fpRound(fp(input)).div(SCALE)
        const ceil = fpCeil(fp(input)).div(SCALE)
        expect(await caller.toUint(fp(input)), `fp(${input})`).to.equal(floor)
        expect(await caller.toUintRnd(fp(input), FLOOR), `fp(${input})`).to.equal(floor)
        expect(await caller.toUintRnd(fp(input), ROUND), `fp(${input})`).to.equal(round)
        expect(await caller.toUintRnd(fp(input), CEIL), `fp(${input})`).to.equal(ceil)
      }
    })
    it('fails on negative Fixes', async () => {
      const table = [-1, fp(MIN_FIX_INT), MIN_INT192, fp(-986349)]
      for (const val of table) {
        await expect(caller.toUint(val), `${val}`).to.be.revertedWith('IntOutOfBounds')
        await expect(caller.toUintRnd(val, FLOOR), `${val}`).to.be.revertedWith('IntOutOfBounds')
        await expect(caller.toUintRnd(val, ROUND), `${val}`).to.be.revertedWith('IntOutOfBounds')
        await expect(caller.toUintRnd(val, CEIL), `${val}`).to.be.revertedWith('IntOutOfBounds')
      }
    })
  })

  describe('shiftl(Fix, int8)', () => {
    it('mirrors the behavior of shiftl_toFix', async () => {
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
        const a = await caller.shiftl(xFix, s)
        const b = await caller.shiftl_toFix_(x, s)
        await expect(a, `toFix(${x}).shiftl(Fix, int8)(${s})`).to.equal(b)
      }
    })
    for (const [k, v] of ROUNDING_MODES) {
      it(`mirrors the behavior of shiftl_toFix - ${v}`, async () => {
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
          const a = await caller.shiftlRnd(xFix, s, k)
          const b = await caller.shiftl_toFix_Rnd(x, s, k)
          await expect(a, `toFix(${x}).shiftl(Fix, int8, RoundingMode)(${s})`).to.equal(b)
        }
      })
    }
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
  describe('mul + mulRnd', () => {
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

    function mulTest(x: string, y: string, result: string) {
      it(`mul(${x}, ${y}) == ${result}`, async () => {
        expect(await caller.mul(fp(x), fp(y))).to.equal(fp(result))
      })
    }

    mulTest('1e-9', '-1e-9', '-1e-18')
    mulTest('0.5e-9', '1e-9', '1e-18')
    mulTest('-0.5e-9', '1e-9', '-1e-18')
    mulTest('0.5e-9', '-1e-9', '-1e-18')
    mulTest('-0.5e-9', '-1e-9', '1e-18')
    mulTest('0.49e-9', '1e-9', '0')
    mulTest('-0.49e-9', '1e-9', '0')
    mulTest('0.49e-9', '-1e-9', '0')
    mulTest('-0.49e-9', '-1e-9', '0')
    mulTest('1.5e-9', '4.5e-8', '68e-18')

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
    it('correctly rounds', async () => {
      const table = mulu_table.flatMap(([a, b]) => [
        [fp(a), fp(b)],
        [fp(a), fp(-b)],
        [fp(-a), fp(b)],
        [fp(-a), fp(-b)],
      ])

      for (const [a, b] of table) {
        const floor = fpFloor(a.mul(b)).div(SCALE)
        const round = fpRound(a.mul(b)).div(SCALE)
        const ceil = fpCeil(a.mul(b)).div(SCALE)
        expect(await caller.mul(a, b), `mul((${a}, ${b})`).to.equal(floor)
        expect(await caller.mulRnd(a, b, FLOOR), `mulRnd((${a}, ${b}, FLOOR)`).to.equal(floor)
        expect(await caller.mulRnd(a, b, ROUND), `mulRnd((${a}, ${b}, ROUND)`).to.equal(round)
        expect(await caller.mulRnd(a, b, CEIL), `mulRnd((${a}, ${b}, CEIL)`).to.equal(ceil)
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
  describe('div + divRnd', () => {
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
    it('correctly rounds', async () => {
      const table = [
        [bn(5), fp(2)],
        [bn(-5), fp(2)],
        [bn(29), fp(10)],
        [bn(-29), fp(10)],
        [bn(19), fp(10)],
        [bn(-19), fp(10)],
      ]

      for (const [a, b] of table) {
        const floor = fpFloor(fp(a).mul(SCALE).div(b)).div(SCALE)
        const round = fpRound(fp(a).mul(SCALE).div(b)).div(SCALE)
        const ceil = fpCeil(fp(a).mul(SCALE).div(b)).div(SCALE)
        expect(await caller.div(a, b), `div((${a}, ${b})`).to.equal(floor)
        expect(await caller.divRnd(a, b, FLOOR), `div((${a}, ${b}, FLOOR)`).to.equal(floor)
        expect(await caller.divRnd(a, b, ROUND), `div((${a}, ${b}, ROUND)`).to.equal(round)
        expect(await caller.divRnd(a, b, CEIL), `div((${a}, ${b}, CEIL)`).to.equal(ceil)
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
  describe('divu + divuRnd', () => {
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
    it('correctly rounds', async () => {
      const table = [
        [bn(5), bn(2)],
        [bn(-5), bn(2)],
        [bn(29), bn(10)],
        [bn(-29), bn(10)],
        [bn(19), bn(10)],
        [bn(-19), bn(10)],
      ]

      for (const [a, b] of table) {
        const floor = fpFloor(fp(a).div(b)).div(SCALE)
        const round = fpRound(fp(a).div(b)).div(SCALE)
        const ceil = fpCeil(fp(a).div(b)).div(SCALE)
        expect(await caller.divu(a, b), `divu((${a}, ${b})`).to.equal(floor)
        expect(await caller.divuRnd(a, b, FLOOR), `divuRnd((${a}, ${b}, FLOOR)`).to.equal(floor)
        expect(await caller.divuRnd(a, b, ROUND), `divuRnd((${a}, ${b}, ROUND)`).to.equal(round)
        expect(await caller.divuRnd(a, b, CEIL), `divuRnd((${a}, ${b}, CEIL)`).to.equal(ceil)
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
  describe('powu', () => {
    describe('correctly exponentiates inside its range', () => {
      // prettier-ignore
      const table = [
        [fp(1.0), bn(1), fp(1.0)],
        [fp(1.0), bn(15), fp(1.0)],
        [fp(2), bn(7), fp(128)],
        [fp(2), bn(63), fp('9223372036854775808')],
        [fp(2), bn(64), fp('18446744073709551616')],
        [fp(1.5), bn(7), fp(17.0859375)],
        [fp(-1), bn(2), fp(1)],
        [fp(-1), bn(2).pow(32).sub(1), fp(-1)],
        [fp(-1), bn(2).pow(32).sub(2), fp(1)],
        [fp(1.1), bn(4), fp('1.4641')],
        [fp(1.1), bn(5), fp('1.61051')],
        [fp(0.23), bn(3), fp('0.012167')],
        [bn(1), bn(2), bn(0)],
        [fp('1e-9'), bn(2), fp('1e-18')],
        [fp(0.1), bn(17), fp('1e-17')],
        [fp(10), bn(19), fp('1e19')]
      ]

      for (const [a, b, c] of table) {
        it(`powu(${shortString(a)}, ${shortString(b)}) == ${shortString(c)}`, async () => {
          expect(await caller.powu(a, b)).to.equal(c)
        })
      }
    })

    describe('correctly exponentiates at the extremes of its range', () => {
      const table = [
        [MAX_INT192, bn(1), MAX_INT192],
        [MIN_INT192, bn(1), MIN_INT192],
        [MIN_INT192, bn(0), fp(1)],
        [fp(0), bn(0), fp(1.0)],
        [fp(987.0), bn(0), fp(1.0)],
        [fp(1.0), bn(2).pow(32).sub(1), fp(1.0)],
        [fp(-1.0), bn(2).pow(32).sub(1), fp(-1.0)],
        [fp(2), bn(131), fp(bn(2).pow(131))],
      ]

      for (const [a, b, c] of table) {
        it(`powu(${shortString(a)}, ${shortString(b)}) == ${shortString(c)}`, async () => {
          expect(await caller.powu(a, b)).to.equal(c)
        })
      }
    })
    describe('fails outside its range', () => {
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
        it(`powu(${shortString(a)}, ${shortString(b)}) reverts}`, async () => {
          await expect(caller.powu(a, b)).to.be.reverted
        })
      }
    })
  })

  describe('lt', () => {
    it('correctly evaluates <', async () => {
      for (const [a, b] of int192Pairs) {
        expect(await caller.lt(a, b), `lt(${a}, ${b})`).to.equal(a.lt(b))
      }
    })
  })
  describe('lte', () => {
    it('correctly evaluates <=', async () => {
      for (const [a, b] of int192Pairs) {
        expect(await caller.lte(a, b), `lte(${a}, ${b})`).to.equal(a.lte(b))
      }
    })
  })
  describe('gt', () => {
    it('correctly evaluates >', async () => {
      for (const [a, b] of int192Pairs) {
        expect(await caller.gt(a, b), `lte(${a}, ${b})`).to.equal(a.gt(b))
      }
    })
  })
  describe('gte', () => {
    it('correctly evaluates >=', async () => {
      for (const [a, b] of int192Pairs) {
        expect(await caller.gte(a, b), `gte(${a}, ${b})`).to.equal(a.gte(b))
      }
    })
  })
  describe('eq', () => {
    it('correctly evaluates ==', async () => {
      for (const [a, b] of int192Pairs) {
        expect(await caller.eq(a, b), `lte(${a}, ${b})`).to.equal(a.eq(b))
        expect(await caller.eq(a, a), `lte(${a}, ${b})`).to.equal(true)
      }
    })
  })
  describe('neq', () => {
    it('correctly evaluates !=', async () => {
      for (const [a, b] of int192Pairs) {
        expect(await caller.neq(a, b), `neq(${a}, ${b})`).to.equal(!a.eq(b))
        expect(await caller.neq(a, a), `neq(${a}, ${b})`).to.equal(false)
      }
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

  describe('shiftl_toUint + shiftl_toUintRnd', () => {
    describe('handles rounding', () => {
      // [fix, shift]
      const table: [BigNumber, number][] = [
        [fp(0), -1],
        [fp(0), -19],
        [fp(1), -1],
        [fp(1), -19],
        [fp('38326665875'), -10],
        [MAX_INT192.sub(1), -1],
        [MAX_INT192.sub(1), -19],
        [MAX_INT192.sub(1), 0],
        [MAX_INT192, -1],
        [MAX_INT192, -19],
      ]

      function expected(x: BigNumber, s: number, rnd: RoundingMode) {
        const leftDigits = s - 18
        const coeff = pow10(bn(leftDigits).abs())
        if (leftDigits >= 0) return x.mul(coeff)
        else return div(x, coeff, rnd)
      }

      for (const [x, s] of table) {
        it(`shiftl_toUint(${x}, ${s})`, async () => {
          expect(await caller.shiftl_toUint(x, s)).to.equal(expected(x, s, FLOOR))
        })
        it(`shiftl_toUintRnd(${x}, ${s}, FLOOR)`, async () => {
          expect(await caller.shiftl_toUintRnd(x, s, FLOOR)).to.equal(expected(x, s, FLOOR))
        })
        it(`shiftl_toUintRnd(${x}, ${s}, ROUND)`, async () => {
          expect(await caller.shiftl_toUintRnd(x, s, ROUND)).to.equal(expected(x, s, ROUND))
        })
        it(`shiftl_toUintRnd(${x}, ${s}, CEIL)`, async () => {
          expect(await caller.shiftl_toUintRnd(x, s, CEIL)).to.equal(expected(x, s, CEIL))
        })
      }
    })
  })
  describe('mulu_toUint + mulu_toUintRnd', () => {
    it('correctly rounds', async () => {
      const table = mulu_table.map(([a, b]) => [fp(a), bn(b)])

      for (const [a, b] of table) {
        const floor = fpFloor(a.mul(b)).div(SCALE)
        const round = fpRound(a.mul(b)).div(SCALE)
        const ceil = fpCeil(a.mul(b)).div(SCALE)
        expect(await caller.mulu_toUint(a, b), `mulu_toUint((${a}, ${b})`).to.equal(floor)
        expect(
          await caller.mulu_toUintRnd(a, b, FLOOR),
          `mulu_toUintRnd((${a}, ${b}, FLOOR)`
        ).to.equal(floor)
        expect(
          await caller.mulu_toUintRnd(a, b, ROUND),
          `mulu_toUintRnd((${a}, ${b}, ROUND)`
        ).to.equal(round)
        expect(
          await caller.mulu_toUintRnd(a, b, CEIL),
          `mulu_toUintRnd((${a}, ${b}, CEIL)`
        ).to.equal(ceil)
      }
    })
  })
  describe('mul_toUint + mul_toUintRnd', () => {
    it('correctly rounds', async () => {
      const table = mulu_table.flatMap(([a, b]) => [
        [fp(a), fp(b)],
        [fp(-a), fp(-b)],
      ])

      for (const [a, b] of table) {
        const floor = fpFloor(a.mul(b).div(SCALE)).div(SCALE)
        const round = fpRound(a.mul(b).div(SCALE)).div(SCALE)
        const ceil = fpCeil(a.mul(b).div(SCALE)).div(SCALE)
        expect(await caller.mul_toUint(a, b), `mul_toUint((${a}, ${b})`).to.equal(floor)
        expect(
          await caller.mul_toUintRnd(a, b, FLOOR),
          `mul_toUintRnd((${a}, ${b}, FLOOR)`
        ).to.equal(floor)
        expect(
          await caller.mul_toUintRnd(a, b, ROUND),
          `mul_toUintRnd((${a}, ${b}, ROUND)`
        ).to.equal(round)
        expect(await caller.mul_toUintRnd(a, b, CEIL), `mul_toUintRnd((${a}, ${b}, CEIL)`).to.equal(
          ceil
        )
      }
    })
  })

  // If seed is an arbitrary (possibly large) uint, return an aribtrary uint in [min, max)
  // some quick bigint utitlity functions
  const abs = (n: bigint) => (n >= 0n ? n : -n)
  const ceilDiv = (x: bigint, y: bigint) => (x >= 0 ? (x + abs(y) - 1n) / y : (x - abs(y) + 1n) / y)
  const roundDiv = (x: bigint, y: bigint) =>
    x >= 0 ? (x + abs(y) / 2n) / y : (x - abs(y) / 2n) / y
  const WORD = 2n ** 256n
  const INTMIN = -(2n ** 191n)
  const INTMAX = 2n ** 191n - 1n

  describe('muluDivu + muluDivuRnd', () => {
    it('muluDivu(0,0,1,*) = 0)', async () => {
      expect(await caller.muluDivuRnd(bn(0), bn(0), bn(1), FLOOR)).to.equal(bn(0))
      expect(await caller.muluDivuRnd(bn(0), bn(0), bn(1), CEIL)).to.equal(bn(0))
      expect(await caller.muluDivuRnd(bn(0), bn(0), bn(1), ROUND)).to.equal(bn(0))
      expect(await caller.muluDivu(bn(0), bn(0), bn(1))).to.equal(bn(0))
    })

    it('muluDivu(,,FLOOR) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigIntN(192), fc.bigUintN(256), fc.bigUintN(256), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = (x * y) / z
          if (INTMIN <= expected && expected <= INTMAX) {
            expect(await caller.muluDivu(bn(x), bn(y), bn(z))).to.equal(bn(expected))
            expect(await caller.muluDivuRnd(bn(x), bn(y), bn(z), FLOOR)).to.equal(bn(expected))
          } else {
            await expect(caller.muluDivu(bn(x), bn(y), bn(z))).to.be.reverted
            await expect(caller.muluDivuRnd(bn(x), bn(y), bn(z), FLOOR)).to.be.reverted
          }
        })
      )
    })

    it('muluDivu(,,CEIL) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigIntN(192), fc.bigUintN(256), fc.bigUintN(256), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = ceilDiv(x * y, z)
          if (INTMIN <= expected && expected <= INTMAX) {
            expect(await caller.muluDivuRnd(bn(x), bn(y), bn(z), CEIL)).to.equal(bn(expected))
          } else {
            await expect(caller.muluDivuRnd(bn(x), bn(y), bn(z), CEIL)).to.be.reverted
          }
        })
      )
    })

    it('muluDivu(,,ROUND) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigIntN(192), fc.bigUintN(256), fc.bigUintN(256), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = roundDiv(x * y, z)
          if (INTMIN <= expected && expected <= INTMAX) {
            expect(await caller.muluDivuRnd(bn(x), bn(y), bn(z), ROUND)).to.equal(bn(expected))
          } else {
            await expect(caller.muluDivuRnd(bn(x), bn(y), bn(z), ROUND)).to.be.reverted
          }
        })
      )
    })
  })

  describe('mulDiv + mulDivRnd', () => {
    it('mulDiv(0,0,*,*) = 0.0)', async () => {
      expect(await caller.mulDivRnd(bn(0), bn(0), fp(1), FLOOR)).to.equal(bn(0))
      expect(await caller.mulDivRnd(bn(0), bn(0), fp(1), CEIL)).to.equal(bn(0))
      expect(await caller.mulDivRnd(bn(0), bn(0), fp(1), ROUND)).to.equal(bn(0))
      expect(await caller.mulDiv(bn(0), bn(0), fp(1))).to.equal(bn(0))

      expect(await caller.mulDivRnd(bn(0), bn(0), bn(1), FLOOR)).to.equal(bn(0))
      expect(await caller.mulDivRnd(bn(0), bn(0), bn(1), CEIL)).to.equal(bn(0))
      expect(await caller.mulDivRnd(bn(0), bn(0), bn(1), ROUND)).to.equal(bn(0))
      expect(await caller.mulDiv(bn(0), bn(0), bn(1))).to.equal(bn(0))
    })

    it('mulDiv(,,FLOOR) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigIntN(192), fc.bigIntN(192), fc.bigIntN(192), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = (x * y) / z
          if (INTMIN <= expected && expected <= INTMAX) {
            expect(await caller.mulDiv(bn(x), bn(y), bn(z))).to.equal(bn(expected))
            expect(await caller.mulDivRnd(bn(x), bn(y), bn(z), FLOOR)).to.equal(bn(expected))
          } else {
            await expect(caller.mulDiv(bn(x), bn(y), bn(z))).to.be.reverted
            await expect(caller.mulDivRnd(bn(x), bn(y), bn(z), FLOOR)).to.be.reverted
          }
        })
      )
    })
    it('mulDiv(,,CEIL) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigIntN(192), fc.bigIntN(192), fc.bigIntN(192), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = ceilDiv(x * y, z)
          if (INTMIN <= expected && expected <= INTMAX) {
            expect(await caller.mulDivRnd(bn(x), bn(y), bn(z), CEIL)).to.equal(bn(expected))
          } else {
            await expect(caller.mulDivRnd(bn(x), bn(y), bn(z), CEIL)).to.be.reverted
          }
        })
      )
    })
    it('mulDiv(,,ROUND) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigIntN(192), fc.bigIntN(192), fc.bigIntN(192), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = roundDiv(x * y, z)
          if (INTMIN <= expected && expected <= INTMAX) {
            expect(await caller.mulDivRnd(bn(x), bn(y), bn(z), ROUND)).to.equal(bn(expected))
          } else {
            await expect(caller.mulDivRnd(bn(x), bn(y), bn(z), ROUND)).to.be.reverted
          }
        })
      )
    })
  })

  describe('mulDiv256 + mulDiv256Rnd', () => {
    it('mulDiv256(0,0,1,*) = 0', async () => {
      expect(await caller.mulDiv256Rnd_(bn(0), bn(0), bn(1), FLOOR)).to.equal(bn(0))
      expect(await caller.mulDiv256Rnd_(bn(0), bn(0), bn(1), ROUND)).to.equal(bn(0))
      expect(await caller.mulDiv256Rnd_(bn(0), bn(0), bn(1), CEIL)).to.equal(bn(0))
      expect(await caller.mulDiv256_(bn(0), bn(0), bn(1))).to.equal(bn(0))
    })

    it('mulDiv256(,,FLOOR) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigUintN(256), fc.bigUintN(256), fc.bigUintN(256), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = (x * y) / z
          if (expected < WORD) {
            expect(await caller.mulDiv256_(bn(x), bn(y), bn(z))).to.equal(bn(expected))
            expect(await caller.mulDiv256Rnd_(bn(x), bn(y), bn(z), FLOOR)).to.equal(bn(expected))
          } else {
            await expect(caller.mulDiv256_(bn(x), bn(y), bn(z))).to.be.reverted
            await expect(caller.mulDiv256Rnd_(bn(x), bn(y), bn(z), FLOOR)).to.be.reverted
          }
        })
      )
    })
    it('mulDiv256(,,CEIL) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigUintN(256), fc.bigUintN(256), fc.bigUintN(256), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = ceilDiv(x * y, z)
          if (expected < WORD) {
            expect(await caller.mulDiv256Rnd_(bn(x), bn(y), bn(z), CEIL)).to.equal(bn(expected))
          } else {
            await expect(caller.mulDiv256Rnd_(bn(x), bn(y), bn(z), CEIL)).to.be.reverted
          }
        })
      )
    })
    it('mulDiv256(,,ROUND) works for many values', async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigUintN(256), fc.bigUintN(256), fc.bigUintN(256), async (x, y, z) => {
          if (z == 0n) return
          const expected: bigint = roundDiv(x * y, z)
          if (expected < WORD) {
            expect(await caller.mulDiv256Rnd_(bn(x), bn(y), bn(z), ROUND)).to.equal(bn(expected))
          } else {
            await expect(caller.mulDiv256Rnd_(bn(x), bn(y), bn(z), ROUND)).to.be.reverted
          }
        })
      )
    })
  })

  describe('fullMul', () => {
    it(`works for many values`, async () => {
      await fc.assert(
        fc.asyncProperty(fc.bigUintN(256), fc.bigUintN(256), async (x, y) => {
          const loExpected = (x * y) % WORD
          const hiExpected = (x * y) / WORD
          const [loResult, hiResult] = await caller.fullMul_(BigNumber.from(x), BigNumber.from(y))
          expect(hiResult).to.equal(hiExpected)
          expect(loResult).to.equal(loExpected)
        }),
        {
          examples: [
            [0n, 0n],
            [0n, 1n],
            [1n, WORD - 1n],
            [WORD - 1n, WORD - 1n],
          ],
        }
      )
    })
    it('fullMul(0,0) = (0,0)', async () => {
      const [lo, hi]: BigNumber[] = await caller.fullMul_(bn(0), bn(0))
      expect(lo).to.equal(bn(0))
      expect(hi).to.equal(bn(0))
    })
  })
})
