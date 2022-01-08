import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory } from 'ethers'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'

import { BN_SCALE_FACTOR } from '../../common/constants'
import { bn, fp, pow10 } from '../../common/numbers'
import { FixedCallerMock } from '../../typechain/FixedCallerMock'

enum RoundingApproach {
  FLOOR,
  ROUND,
  CEIL,
}

describe('In FixLib,', async () => {
  let owner: SignerWithAddress
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
  const fixable_ints: BigNumber[] = [
    bn(0), bn(1), bn(-1), MAX_FIX_INT, MIN_FIX_INT, MAX_FIX_INT.sub(1), MIN_FIX_INT.add(1),
    bn('38326665875765560393'), bn('-01942957121544002253'),
  ]
  // prettier-ignore
  const unfixable_ints: BigNumber[] = [
    MAX_FIX_INT.add(1), MIN_FIX_INT.sub(1), MAX_FIX_INT.mul(2), MAX_FIX_INT.mul(-27)
  ]

  // prettier-ignore
  const positive_int192s: BigNumber[] = [
    bn(1), fp(0.9999), fp(1), fp(1.0001), MAX_INT192.sub(1), MAX_INT192,
  ]
  let negative_int192s = positive_int192s.map(neg)
  negative_int192s.reverse()

  const int192s: BigNumber[] = [MIN_INT192, ...negative_int192s, bn(0), ...positive_int192s]

  // This is before() instead of beforeEach():
  // All of these functions are pure, so the contract state can be reused.
  before(async () => {
    ;[owner] = await ethers.getSigners()
    FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  describe('intToFix', async () => {
    it('correctly converts int values', async () => {
      fixable_ints.forEach(async (x) => expect(await caller.intToFix(x), `${x}`).to.equal(fp(x)))
    })
    it('fails on values outside its domain', async () => {
      ;[MAX_FIX_INT.add(1), MIN_FIX_INT.sub(1), MAX_FIX_INT.mul(25)].forEach(
        async (x) => await expect(caller.intToFix(x)).to.be.revertedWith('IntOutOfBounds')
      )
    })
  })

  describe('toFix(x)', async () => {
    it('correctly converts uint values', async () => {
      ;[0, 1, 2, '38326665875765560393', MAX_FIX_INT.sub(1), MAX_FIX_INT]
        .map(bn)
        .forEach(async (x) => expect(await caller.toFix(x), `${x}`).to.equal(fp(x)))
    })

    it('fails on inputs outside its domain', async () => {
      await expect(caller.toFix(MAX_FIX_INT.add(1))).to.be.revertedWith('UIntOutOfBounds')
      await expect(caller.toFix(MAX_FIX_INT.mul(17))).to.be.revertedWith('UIntOutOfBounds')
    })
  })

  describe('toFix(x, shiftLeft)', async () => {
    it('correctly converts uint values with no shifting', async () => {
      ;[0, 1, 2, '38326665875765560393', MAX_FIX_INT.sub(1), MAX_FIX_INT]
        .map(bn)
        .forEach(async (x) => expect(await caller.toFixWithShift(x, bn(0)), `${x}`).to.equal(fp(x)))
    })

    it('correctly converts uint values with some shifting', async () => {
      ;[
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
      ]
        .map(([x, s]) => [bn(x), bn(s)])
        .forEach(async ([x, s]) =>
          expect(await caller.toFixWithShift(x, s), `toFixWithShift(${x}, ${s})`).to.equal(
            s.gte(0) ? fp(x).mul(pow10(s)) : fp(x).div(pow10(neg(s)))
          )
        )
    })

    it('fails on inputs outside its domain', async () => {
      ;[
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
      ].forEach(
        async ([x, s]) =>
          await expect(caller.toFixWithShift(x, s), `toFix(${x}, ${s})`).to.be.reverted
      )
    })
  })

  describe('divFix', async () => {
    it('correctly divides inside its range', async () => {
      //prettier-ignore
      ;[[10, 1, 10], [10, 2, 5], [20, 2.5, 8], [1, 5, 0.2], [256, 256, 1],]
        .flatMap(([x, y, z]) => [[x, y, z], [x, -y, -z], [x, z, y], [x, -z, -y],])
        .concat([[0, 1, 0], [0, -1, 0],])
        .forEach(async ([x, y, result]) =>
          expect(await caller.divFix(x, fp(y)), `divFix(${x}, ${y}) == ${result}`).to.equal(fp(result))
        )
    })

    it('works for extreme results', async () => {
      // For cases that exercise the complicated path, we need:
      // 5.8e40 <= x < 5.8e76, fp(-3.14e39) <= y, result <= fp(3.14e39)
      ;[
        [MAX_FIX_INT, fp(1), fp(MAX_FIX_INT)],
        [MAX_FIX_INT.sub(51), fp(1), fp(MAX_FIX_INT.sub(51))],
        [MAX_FIX_INT.mul(173), fp(173), fp(MAX_FIX_INT)],
        [MAX_INT192, fp('1e18'), MAX_INT192],
        [neg(MIN_INT192), fp('-1e18'), MIN_INT192],
        [bn('8e60'), fp('2e30'), fp('4e30')],
        [bn('5e75'), fp('2.5e39'), fp('2e36')],
        [bn('8e60'), fp('-2e30'), fp('-4e30')],
        [bn('5e75'), fp('-2.5e39'), fp('-2e36')],
      ].forEach(async ([x, y, result]) =>
        expect(await caller.divFix(x, y), `divFix(${x}, ${y}) == ${result}`).to.equal(result)
      )
    })

    it('fails when results fall outside its range', async () => {
      await expect(caller.divFix(MAX_INT192.add(1), fp(1))).to.be.reverted
      await expect(caller.divFix(MAX_INT192.div(5), fp('0.199'))).to.be.reverted
    })
    it('fails on division by zero', async () => {
      await expect(caller.divFix(17, fp(0))).to.be.revertedWith('panic code 0x12')
      await expect(caller.divFix(0, fp(0))).to.be.revertedWith('panic code 0x12')
      await expect(caller.divFix(MAX_INT192, fp(0))).to.be.revertedWith('panic code 0x12')
    })
  })

  describe('toInt', async () => {
    it('correctly converts Fixes to int192', async () => {
      for (let result of fixable_ints) {
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
      for (let [input, result] of table) {
        expect(await caller.toInt(fp(input)), `${input}`).to.equal(result)
      }
    })
  })

  describe('shiftLeft', async () => {
    it('mirrors the behavior of `toFixWithShift`', async () => {
      ;[
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
      ]
        .map(([x, s]) => [bn(x), bn(s)])
        .forEach(async ([x, s]) => {
          const xFix = await caller.toFix(x)
          const a = await caller.shiftLeft(xFix, s)
          const b = await caller.toFixWithShift(x, s)

          await expect(await caller.shiftLeft(xFix, s), `toFix(${x}).shiftLeft(${s})`).to.equal(
            await caller.toFixWithShift(x, s)
          )
        })
    })
  })

  describe('intRound', async () => {
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
        [0, 0], [0.5, 1], [-0.5, -1],
      ]
      for (let [input, result] of table) {
        expect(await caller.intRound(fp(input)), `fp(${input})`).to.equal(result)
      }
    })
  })

  describe('floor', async () => {
    it('correctly converts positive Fixes to uint192', async () => {
      for (let result of fixable_ints) {
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
      for (let val of table) {
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
        [0.5, 0],
      ]
      for (let [input, result] of table) {
        expect(await caller.floor(fp(input)), `fp(${input})`).to.equal(result)
        expect(await caller.toUint(fp(input), RoundingApproach.FLOOR), `fp(${input})`).to.equal(
          result
        )
      }
    })
  })

  describe('round', async () => {
    it('correctly rounds to nearest uint', async () => {
      // prettier-ignore
      const table = [
        [1.1, 1], [1.9, 2], [1, 1], [0.1, 0],
        [705811305.5207, 705811306], [705811305.207, 705811305],
        [3.4999, 3], [3.50001, 4], 
        [MAX_FIX_INT, MAX_FIX_INT],
        [9.99999, 10], 
        [6.5, 7], [5.5, 6],
        [0, 0], [0.5, 1], 
      ]
      for (let [input, result] of table) {
        expect(await caller.round(fp(input)), `fp(${input})`).to.equal(result)
        expect(await caller.toUint(fp(input), RoundingApproach.ROUND), `fp(${input})`).to.equal(
          result
        )
      }
    })
  })

  describe('ceil', async () => {
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
        [0.5, 1],
      ]
      for (let [input, result] of table) {
        expect(await caller.ceil(fp(input)), `fp(${input})`).to.equal(result)
        expect(await caller.toUint(fp(input), RoundingApproach.CEIL), `fp(${input})`).to.equal(
          result
        )
      }
    })
  })

  describe('plus', async () => {
    it('correctly adds in its range', async () => {
      const table_init = [
        [13, 25, 38],
        [0.1, 0.2, 0.3],
        [1, -1, 0],
        [5040, 301, 5341],
        [0, 0, 0],
        [0.1, -0.1, 0],
      ]
      let table = []
      for (let [a, b, c] of table_init)
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
      table.push(
        ['1e-18', '2e-18', '3e-18'],
        [MAX_FIX_INT, 0, MAX_FIX_INT],
        [MAX_FIX_INT, MAX_FIX_INT.mul(-1), 0],
        [MAX_FIX_INT.div(8).mul(3), MAX_FIX_INT.div(8).mul(5), MAX_FIX_INT.div(8).mul(8)]
      )
      for (let [a, b, c] of table)
        expect(await caller.plus(fp(a), fp(b)), `${a} + ${b}`).to.equal(fp(c))
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

  describe('plusi', async () => {
    it('correctly adds in its range', async () => {
      const table_init = [
        [13, 25, 38],
        [0.1, 0, 0.1],
        [1, -1, 0],
        [5040, 301, 5341],
        [0, 0, 0],
        [0.1, 3, 3.1],
      ]
      let table = []
      for (let [a, b, c] of table_init) {
        table.push([a, b, c], [-a, -b, -c], [c, -b, a], [-c, b, -a])
      }
      for (let [a, b, c] of table) {
        expect(await caller.plusi(fp(a), b), `plusi(${a}, ${b})`).to.equal(fp(c))
      }
    })

    it('correctly adds at the extremes of its range', async () => {
      expect(await caller.plusi(MAX_INT192.sub(SCALE.mul(3)), 3), 'plusi(MAX-3, 3)').to.equal(
        MAX_INT192
      )
      const max_mantissa = MAX_INT192.mod(SCALE)
      expect(
        await caller.plusi(max_mantissa.sub(fp(12345)), MAX_FIX_INT.add(12345)),
        'plusi(max_mantissa - 12345, MAX_FIX_INT + 12345)'
      ).to.equal(MAX_INT192)

      expect(await caller.plusi(MIN_INT192.add(SCALE.mul(3)), -3), 'plusi(MIN+3, -3)').to.equal(
        MIN_INT192
      )
    })

    it('fails outside its range', async () => {
      await expect(caller.plusi(MAX_INT192.sub(SCALE.mul(3)).add(1), 3), 'plusi(MAX-3+eps, 3)').to
        .be.reverted
      await expect(caller.plusi(MAX_INT192.sub(SCALE.mul(3)), 4), 'plusi(MAX-3, 4)').to.be.reverted
      await expect(caller.plusi(0, MAX_FIX_INT.add(1)), 'plusi(0, MAX_FIX + 1)').to.be.reverted
      await expect(caller.plusi(0, MIN_FIX_INT.sub(1)), 'plusi(0, MIN_FIX - 1)').to.be.reverted
      await expect(caller.plusi(MIN_INT192, -1), 'plusi(MIN, -1)').to.be.reverted
      await expect(caller.plusi(MIN_INT192.add(SCALE.mul(3)).sub(1), -3), 'plusi(MIN+3-eps, -3)').to
        .be.reverted
    })
  })

  describe('plusu', async () => {
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
      for (let [a, b, c] of table) {
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

  describe('minus', async () => {
    it('correctly subtracts in its range', async () => {
      const table_init = [
        [13, -25, 38],
        [0.1, -0.2, 0.3],
        [1, 1, 0],
        [5040, -301, 5341],
        [0, 0, 0],
        [0.1, 0.1, 0],
      ]
      let table = []
      for (let [a, b, c] of table_init)
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
      table.push(
        ['3e-18', '2e-18', '1e-18'],
        [MAX_FIX_INT, 0, MAX_FIX_INT],
        [MAX_FIX_INT, MAX_FIX_INT, 0],
        [MAX_FIX_INT.div(8).mul(5), MAX_FIX_INT.div(8).mul(-3), MAX_FIX_INT.div(8).mul(8)]
      )
      for (let [a, b, c] of table)
        expect(await caller.minus(fp(a), fp(b)), `${a} + ${b}`).to.equal(fp(c))
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
  describe('minusi', async () => {
    it('correctly subtracts in its range', async () => {
      const table_init = [
        [13, -25, 38],
        [0.1, 0, 0.1],
        [1, 1, 0],
        [5040, -301, 5341],
        [0, 0, 0],
        [0.1, -3, 3.1],
        [11.37, 2, 9.37],
      ]
      let table = []
      for (let [a, b, c] of table_init) {
        table.push([a, b, c], [-a, -b, -c], [-c, b, -a], [c, -b, a])
      }
      for (let [a, b, c] of table) {
        expect(await caller.minusi(fp(a), b), `minusi(${a}, ${b})`).to.equal(fp(c))
      }
    })

    it('correctly subtacts at the extremes of its range', async () => {
      expect(await caller.minusi(MAX_INT192.sub(SCALE.mul(3)), -3), 'minusi(MAX-3, -3)').to.equal(
        MAX_INT192
      )
      const max_mantissa = MAX_INT192.mod(SCALE)
      expect(
        await caller.minusi(max_mantissa.sub(fp(12349)), MAX_FIX_INT.add(12349).mul(-1)),
        'minusi(max_mantissa - 12349, -(MAX_FIX_INT + 12349))'
      ).to.equal(MAX_INT192)

      expect(await caller.minusi(MIN_INT192.add(SCALE.mul(7)), 7), 'minusi(MIN+7, 7)').to.equal(
        MIN_INT192
      )
    })

    it('fails outside its range', async () => {
      await expect(caller.minusi(MAX_INT192.sub(SCALE.mul(3)).add(1), -3), 'minusi(MAX-3+eps, -3)')
        .to.be.reverted
      await expect(caller.minusi(MAX_INT192.sub(SCALE.mul(3)), -4), 'minusi(MAX-3, -4)').to.be
        .reverted
      await expect(caller.minusi(0, MAX_FIX_INT.add(1).mul(-1)), 'minusi(0, -(MAX_FIX + 1))').to.be
        .reverted
      await expect(caller.minusi(0, MIN_FIX_INT.mul(-1).add(1)), 'minusi(0, -MIN_FIX +1)').to.be
        .reverted
      await expect(caller.minusi(MIN_INT192, 1), 'minusi(MIN, 1)').to.be.reverted
      await expect(caller.minusi(MIN_INT192.add(SCALE.mul(3)).sub(1), 3), 'minusi(MIN+3-eps, 3)').to
        .be.reverted
    })
  })

  describe('minusu', async () => {
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
      for (let [a, b, c] of table) {
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
  describe('mul', async () => {
    it('correctly multiplies inside its range', async () => {
      let commutes = mulu_table.flatMap(([a, b, c]) => [
        [a, b, c],
        [b, a, c],
      ])
      let table = commutes.flatMap(([a, b, c]) => [
        [a, b, c],
        [-a, b, -c],
        [a, -b, -c],
        [-a, -b, c],
      ])
      for (let [a, b, c] of table) {
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
      for (let [a, b, c] of table) {
        expect(await caller.mul(a, b), `mul(${a}, ${b})`).to.equal(c)
        expect(await caller.mul(b, a), `mul(${b}, ${a})`).to.equal(c)
      }
    })
    it('fails outside its range', async () => {
      await expect(caller.mul(MIN_INT192, fp(-1)), `mul(MIN, -1)`).to.be.reverted
      await expect(caller.mul(MAX_INT192.div(2).add(1), fp(2)), `mul(MAX/2 + 2, 2)`).to.be.reverted
      await expect(caller.mul(fp(bn(2).pow(81)), fp(bn(2).pow(81))), `mul(2^81, 2^81)`).to.be
        .reverted
      await expect(caller.mul(fp(bn(2).pow(81).mul(-1)), fp(bn(2).pow(81))), `mul(-2^81, 2^81)`).to
        .be.reverted
    })
  })
  describe('muli', async () => {
    it('correctly multiplies inside its range', async () => {
      let table = mulu_table.flatMap(([a, b, c]) => [
        [a, b, c],
        [-a, b, -c],
        [a, -b, -c],
        [-a, -b, c],
      ])
      for (let [a, b, c] of table)
        expect(await caller.muli(fp(a), b), `muli(fp(${a}), ${b})`).to.equal(fp(c))
    })
    it('correctly multiplies at the extremes of its range', async () => {
      const table = [
        [MAX_INT192, 1, MAX_INT192],
        [MIN_INT192, 1, MIN_INT192],
        [fp(1), MAX_FIX_INT, fp(MAX_FIX_INT)],
        [MIN_INT192.div(256), 256, MIN_INT192],
        [MAX_INT192.sub(1).div(2), 2, MAX_INT192.sub(1)],
        [MAX_INT192, -1, MIN_INT192.add(1)],
      ]
      for (let [a, b, c] of table) expect(await caller.muli(a, b), `muli(${a}, ${b})`).to.equal(c)
    })
    it('fails outside its range', async () => {
      const table = [
        [MIN_INT192, -1],
        [MAX_INT192.div(2).add(1), 2],
        [fp(bn(2).pow(68)), bn(2).pow(81)],
        [MAX_INT192, MAX_INT192],
        [MAX_INT192, MIN_INT192],
        [MIN_INT192, MAX_INT192],
        [MIN_INT192, MIN_INT192],
      ]
      for (let [a, b, c] of table)
        await expect(caller.muli(a, b), `muli(${a}, ${b})`).to.be.reverted
    })
  })
  describe('mulu', async () => {
    it('correctly multiplies inside its range', async () => {
      let table = mulu_table.flatMap(([a, b, c]) => [
        [a, b, c],
        [-a, b, -c],
      ])
      for (let [a, b, c] of table)
        expect(await caller.mulu(fp(a), b), `mulu(fp(${a}), ${b})`).to.equal(fp(c))
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
      for (let [a, b, c] of table) expect(await caller.mulu(a, b), `mulu(${a}, ${b})`).to.equal(c)
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
      for (let [a, b, c] of table)
        await expect(caller.mulu(a, b), `mulu(${a}, ${b})`).to.be.reverted
    })
  })
  describe('div', async () => {
    it('correctly divides inside its range', async () => {
      // prettier-ignore
      const table: BigNumber[][] = [
        [fp(100), fp(20), fp(5)],
        [fp(1.0), fp(25), fp(0.04)],
        [bn(50), fp(50), bn(1)],
        [bn(2), bn(2), fp(1)],
        [bn(3), bn(2), fp(1.5)],
        [fp(1), bn(1), fp('1e18')],
        [bn(1), fp(1), bn(1)],
      ].flatMap(([a, b, c]) => [[a, b, c], [a, c, b],])
        .flatMap(([a, b, c]) => [[a, b, c], [neg(a), b, neg(c)],])
        .flatMap(([a, b, c]) => [[a, b, c], [a, neg(b), neg(c)],])

      table.forEach(async ([a, b, c]) =>
        expect(await caller.div(a, b), `div(${a}, ${b})`).to.equal(c)
      )
    })
    it('correctly divides at the extremes of its range', async () => {
      // prettier-ignore
      const table: BigNumber[][] = [
        [MAX_INT192, fp(1), MAX_INT192],
        [MAX_INT192, fp(-1), neg(MAX_INT192)],
        [MIN_INT192, fp(2), MIN_INT192.div(2)],
      ].flatMap(([a, b, c]) => [[a, b, c], [a, c, b],])

      table.forEach(async ([a, b, c]) =>
        expect(await caller.div(a, b), `div((${a}, ${b})`).to.equal(c)
      )
    })
    it('correctly truncates results (towards zero)', async () => {
      const table = [
        [bn(5), fp(2), bn(2)],
        [bn(-5), fp(2), bn(-2)],
        [bn(29), fp(10), bn(2)],
        [bn(-19), fp(10), bn(-1)],
      ]
      table.forEach(async ([a, b, c]) =>
        expect(await caller.div(a, b), `div((${a}, ${b})`).to.equal(c)
      )
    })
    it('fails outside its range', async () => {
      // prettier-ignore
      const table: BigNumber[][] = [
        [MAX_INT192, fp(0.99)],
        [MAX_INT192.div(5), fp(0.19)],
        [MAX_INT192.div(pow10(16)), bn(1)],
        [MIN_INT192, fp(0.99)],
        [MIN_INT192.div(5), fp(0.19)],
        [MIN_INT192.div(pow10(16)), bn(1)],
      ].flatMap(([a, b]) => [[a, b], [a, neg(b)]])

      table.forEach(
        async ([a, b]) => await expect(caller.div(a, b), `div((${a}, ${b})`).to.be.reverted
      )
    })
    it('fails to divide by zero', async () => {
      // prettier-ignore
      ;[fp(1), fp(MAX_INT192), fp(MIN_INT192), fp(0), fp(-1), bn(1), bn(-1), bn(987162349587)]
        .forEach(async (x) => await expect(caller.div(x, bn(0)), `div(${x}, 0`).to.be.reverted)
    })
  })
  describe('divi', async () => {
    it('correctly divides inside its range', async () => {
      // prettier-ignore
      ;[
        [fp(100), bn(20), fp(5)],
        [fp(1.0), bn(25), fp(0.04)],
        [bn(50), bn(50), bn(1)],
        [fp(2), bn(2), fp(1)],
        [fp(3), bn(2), fp(1.5)],
        [fp(1), bn(1), fp(1)],
        [bn(1), bn(1), bn(1)],
      ].flatMap(([a, b, c]) => [[a, b, c], [neg(a), b, neg(c)],])
        .flatMap(([a, b, c]) => [[a, b, c], [a, neg(b), neg(c)],])
        .forEach(async ([a, b, c]) => expect(await caller.divi(a, b), `divi(${a}, ${b})`).to.equal(c))
    })
    it('correctly divides at the extremes of its range', async () => {
      // prettier-ignore
      ;[
        [MAX_INT192, bn(1), MAX_INT192],
        [MAX_INT192, bn(-1), neg(MAX_INT192)],
        [MIN_INT192, bn(2), MIN_INT192.div(2)],
      ].flatMap(([a, b, c]) => [[a, b, c], [a, c, b],])
        .forEach(async ([a, b, c]) => expect(await caller.divi(a, b), `divi(${a}, ${b})`).to.equal(c))
    })
    it('correctly truncates results towards zero', async () => {
      // prettier-ignore
      ;[
        [bn(5), bn(2), bn(2)],
        [bn(-5), bn(2), bn(-2)],
        [bn(29), bn(10), bn(2)],
        [bn(-19), bn(10), bn(-1)],
      ].forEach(async ([a, b, c]) => expect(await caller.divi(a, b), `divi((${a}, ${b})`).to.equal(c))
    })
    it('fails to divide by zero', async () => {
      // prettier-ignore
      ;[fp(1), fp(MAX_INT192), fp(MIN_INT192), fp(0), fp(-1), bn(1), bn(-1), bn(987162349587)]
        .forEach(async (x) => await expect(caller.divi(x, bn(0)), `divi(${x}, 0`).to.be.reverted)
    })
  })
  describe('divu', async () => {
    it('correctly divides inside its range', async () => {
      // prettier-ignore
      ;[
        [fp(100), bn(20), fp(5)],
        [fp(1.0), bn(25), fp(0.04)],
        [bn(50), bn(50), bn(1)],
        [fp(2), bn(2), fp(1)],
        [fp(3), bn(2), fp(1.5)],
        [fp(1), bn(1), fp(1)],
        [bn(1), bn(1), bn(1)],
      ].forEach(async ([a, b, c]) => expect(await caller.divu(a, b), `divu((${a}, ${b})`).to.equal(c))
    })
    it('correctly divides at the extremes of its range', async () => {
      // prettier-ignore
      ;[
        [MAX_INT192, bn(1), MAX_INT192],
        [MIN_INT192, bn(1), MIN_INT192],
        [MIN_INT192, bn(2), MIN_INT192.div(2)],
      ].forEach(async ([a, b, c]) => expect(await caller.divu(a, b), `divu(${a}, ${b})`).to.equal(c))
    })
    it('correctly truncates results towards zero', async () => {
      // prettier-ignore
      ;[
        [bn(5), bn(2), bn(2)],
        [bn(-5), bn(2), bn(-2)],
        [bn(29), bn(10), bn(2)],
        [bn(-19), bn(10), bn(-1)],
      ].forEach(async ([a, b, c]) => expect(await caller.divu(a, b), `divu((${a}, ${b})`).to.equal(c))
    })
    it('fails to divide by zero', async () => {
      // prettier-ignore
      ;[fp(1), fp(MAX_INT192), fp(MIN_INT192), fp(0), fp(-1), bn(1), bn(-1), bn(987162349587)]
        .forEach(async (x) => await expect(caller.divu(x, bn(0)), `divu(${x}, 0`).to.be.reverted)
    })
  })
  describe('inv', async () => {
    it('correctly inverts inside its range', async () => {
      // prettier-ignore
      ;[
        [fp(1), fp(1)],
        [fp(2), fp(0.5)],
        [bn(2), fp('0.5e18')],
        [bn(1e9), fp(1e9)],
      ].flatMap(([a, b]) => [[a, b], [b, a], [neg(a), neg(b)], [neg(b), neg(a)]])
        .forEach(async ([a, b]) => expect(await caller.inv(a), `inv(${a})`).to.equal(b))
    })
    it('correctly inverts at the extremes of its range', async () => {
      // prettier-ignore
      ;[
        [MAX_INT192, 0],
        [MIN_INT192, 0],
        [fp('1e18'), bn(1)],
        [fp('-1e18'), bn(-1)],
        [bn(1), fp('1e18')],
        [bn(-1), fp('-1e18')],
      ].forEach(async ([a, b]) => expect(await caller.inv(a), `inv(${a})`).to.equal(b))
    })
    it('fails to invert zero', async () => {
      await expect(caller.inv(bn(0))).to.be.reverted
    })
  })
  describe('powu', async () => {
    it('correctly exponentiates inside its range', async () => {
      // prettier-ignore
      ;[
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
        [fp(10), bn(19), fp('1e19')],
      ].forEach(async ([a, b, c]) => expect(await caller.powu(a, b), `powu(${a}, ${b})`).to.equal(c))
    })
    it('correctly exponentiates at the extremes of its range', async () => {
      ;[
        [MAX_INT192, bn(1), MAX_INT192],
        [MIN_INT192, bn(1), MIN_INT192],
        [MIN_INT192, bn(0), fp(1)],
        [fp(0), bn(0), fp(1.0)],
        [fp(987.0), bn(0), fp(1.0)],
        [fp(1.0), bn(2).pow(256).sub(1), fp(1.0)],
        [fp(-1.0), bn(2).pow(256).sub(1), fp(-1.0)],
      ].forEach(async ([a, b, c]) =>
        expect(await caller.powu(a, b), `powu(${a}, ${b})`).to.equal(c)
      )
    })
    it('fails outside its range', async () => {
      ;[
        [fp(10), bn(40)],
        [fp(-10), bn(40)],
        [MAX_INT192, bn(2)],
        [MIN_INT192, bn(2)],
        [fp('8e19'), bn(2)],
        [fp('1.9e13'), bn(3)],
        [fp('9e9'), bn(4)],
        [fp('9.2e8'), bn(5)],
      ].forEach(
        async ([a, b]) => await expect(caller.powu(a, b), `powu(${a}, ${b})`).to.be.reverted
      )
    })
  })

  describe('lt', async () => {
    it('correctly evaluates <', async () => {
      int192s.forEach(async (a) =>
        int192s.forEach(async (b) =>
          expect(await caller.lt(a, b), `lt(${a}, ${b})`).to.equal(a.lt(b))
        )
      )
    })
  })
  describe('lte', async () => {
    it('correctly evaluates <=', async () => {
      int192s.forEach(async (a) =>
        int192s.forEach(async (b) =>
          expect(await caller.lte(a, b), `lte(${a}, ${b})`).to.equal(a.lte(b))
        )
      )
    })
  })
  describe('gt', async () => {
    it('correctly evaluates >', async () => {
      int192s.forEach(async (a) =>
        int192s.forEach(async (b) =>
          expect(await caller.gt(a, b), `gt(${a}, ${b})`).to.equal(a.gt(b))
        )
      )
    })
  })
  describe('gte', async () => {
    it('correctly evaluates >=', async () => {
      int192s.forEach(async (a) =>
        int192s.forEach(async (b) =>
          expect(await caller.gte(a, b), `gte(${a}, ${b})`).to.equal(a.gte(b))
        )
      )
    })
  })
  describe('eq', async () => {
    it('correctly evaluates ==', async () => {
      int192s.forEach(async (a) =>
        int192s.forEach(async (b) =>
          expect(await caller.eq(a, b), `eq(${a}, ${b})`).to.equal(a.eq(b))
        )
      )
    })
  })
  describe('neq', async () => {
    it('correctly evaluates !=', async () => {
      int192s.forEach(async (a) =>
        int192s.forEach(async (b) =>
          expect(await caller.neq(a, b), `neq(${a}, ${b})`).to.equal(!a.eq(b))
        )
      )
    })
  })
  describe('fixMin', async () => {
    it('correctly evaluates min', async () => {
      int192s.forEach(async (a) =>
        int192s.forEach(async (b) =>
          expect(await caller.fixMin(a, b), `fixMin(${a}, ${b})`).to.equal(a.lt(b) ? a : b)
        )
      )
    })
  })
  describe('fixMax', async () => {
    it('correctly evaluates max', async () => {
      int192s.forEach(async (a) =>
        int192s.forEach(async (b) =>
          expect(await caller.fixMax(a, b), `fixMax(${a}, ${b})`).to.equal(a.gt(b) ? a : b)
        )
      )
    })
  })

  describe('near', async () => {
    it('correctly evaluates approximate equality', async () => {
      // prettier-ignore
      ;[
        [fp(0), fp(0.1), fp(0.10001)],
        [fp(1), fp('1.00001'), fp('0.00001')],
        [fp(1), fp('1.000014'), fp('0.00001')],
        [fp(1), fp('1.000007'), fp('0.00001')],
        [fp(1), fp('1.00001'), fp('0.000010001')],
        [bn(87654), bn(87654), bn(1)],
        [bn(87654), bn(87655), bn(1)],
        [bn(87654), bn(87655), bn(2)],
        [fp(1.0), fp(1.0), bn(1)],
      ].flatMap(([a, b, c]) => [[a, b, c], [b, a, c], [neg(a), neg(b), c], [neg(b), neg(a), c]])
        .forEach(async ([a, b, c]) =>
          expect(await caller.near(a, b, c), `near(${a}, ${b}, ${c}`).to.equal(a.sub(b).abs().lt(c)))
    })
    it('correctly evaluates approximate equality at the extremes of its range', async () => {
      // prettier-ignore
      ;[
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

      ].flatMap(([a, b, c]) => [[a, b, c], [b, a, c],])
        .forEach(async ([a, b, c]) =>
          expect(await caller.near(a, b, c), `near(${a}, ${b}, ${c}`).to.equal(a.sub(b).abs().lt(c)))
    })
  })
})
