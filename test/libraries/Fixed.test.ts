import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BN_SCALE_FACTOR } from '../../common/constants'
import { bn, fp, pow10 } from '../../common/numbers'

import { ContractFactory } from 'ethers'
import { BigNumber, BigNumberish } from 'ethers'
import { FixedCallerMock } from '../../typechain/FixedCallerMock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('In FixLib,', async () => {
  let owner: SignerWithAddress
  let FixedCaller: ContractFactory
  let caller: FixedCallerMock

  const SCALE = BN_SCALE_FACTOR
  const MAX_INT128 = BigNumber.from(2).pow(127).sub(1)
  const MIN_INT128 = BigNumber.from(2).pow(127).mul(-1)
  const MAX_UINT128 = BigNumber.from(2).pow(128).sub(1)
  const MAX_FIX_INT = MAX_INT128.div(pow10(18)) // biggest integer N st toFix(N) exists
  const MIN_FIX_INT = MIN_INT128.div(pow10(18)) // smallest integer N st toFix(N) exists

  const fixable_ints: BigNumberish[] = [
    0,
    1,
    -1,
    MAX_FIX_INT,
    MIN_FIX_INT,
    MAX_FIX_INT.sub(1),
    MIN_FIX_INT.add(1),
    '38326665875765560393',
    '-01942957121544002253',
  ]
  const unfixable_ints: BigNumberish[] = [
    MAX_FIX_INT.add(1),
    MIN_FIX_INT.sub(1),
    MAX_FIX_INT.mul(2),
    MAX_FIX_INT.mul(-27),
  ]

  before(async () => {
    ;[owner] = await ethers.getSigners()
    FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  describe('intToFix', async () => {
    it('correctly converts int values', async () => {
      for (let input of fixable_ints) {
        expect(await caller.intToFix(bn(input)), `intToFix(${input})`).to.equal(fp(input))
      }
    })
    it('fails on values outside its domain', async () => {
      await expect(caller.intToFix(MAX_FIX_INT.add(1))).to.be.revertedWith('IntOutOfBounds')
      await expect(caller.intToFix(MIN_FIX_INT.sub(1))).to.be.revertedWith('IntOutOfBounds')
      await expect(caller.intToFix(MAX_FIX_INT.mul(25))).to.be.revertedWith('IntOutOfBounds')
    })
  })

  describe('toFix', async () => {
    it('correctly converts uint values', async () => {
      const table = [0, 1, 2, '38326665875765560393', MAX_FIX_INT.sub(1), MAX_FIX_INT]
      for (let input of table) {
        expect(await caller.toFix(bn(input)), `toFix(${input})`).to.equal(fp(input))
      }
    })

    it('fails on inputs outside its domain', async () => {
      await expect(caller.toFix(MAX_FIX_INT.add(1))).to.be.revertedWith('UIntOutOfBounds')
      await expect(caller.toFix(MAX_FIX_INT.mul(17))).to.be.revertedWith('UIntOutOfBounds')
    })
  })

  describe('divFix', async () => {
    it('correctly computes (uint x / Fix y)', async () => {
      const table_init = [
        [10, 1, 10],
        [10, 2, 5],
        [20, 2.5, 8],
        [1, 5, 0.2],
        [256, 256, 1],
      ]
      let table = []
      // stretch table with equivalent tests
      for (const [x, y, result] of table_init) {
        table.push([x, y, result], [x, -y, -result], [x, result, y], [x, -result, -y])
      }
      table.push([0, 1, 0], [0, -1, 0])
      for (const [x, y, result] of table) {
        expect(await caller.divFix(x, fp(y)), `divFix(${x}, ${y}) == ${result}`).to.equal(fp(result))
      }
    })

    it('works for extreme results', async () => {
      // uint(MAX_INT128) / 1e18 == Fix(MAX_INT128) (largest possible Fix value)
      expect(await caller.divFix(MAX_INT128, fp('1e18'))).to.equal(MAX_INT128)
      // 171e18 > MAX_FIX_INT > 170e18, so we use 170e18 here.
      expect(await caller.divFix(MAX_INT128.mul(170), fp('170e18'))).to.equal(MAX_INT128)

      expect(await caller.divFix(MAX_INT128.sub(1), fp('1e18'))).to.equal(MAX_INT128.sub(1))
      expect(await caller.divFix(MAX_INT128.sub(51), fp('1e18'))).to.equal(MAX_INT128.sub(51))
    })
    it('fails when results fall outside its range', async () => {
      await expect(caller.divFix(MAX_INT128.add(1), fp('1e18'))).to.be.revertedWith('IntOutOfBounds')
      await expect(caller.divFix(MAX_INT128.div(5), fp('0.199e18'))).to.be.revertedWith('IntOutOfBounds')
    })
    it('fails on division by zero', async () => {
      await expect(caller.divFix(17, fp(0))).to.be.revertedWith('panic code 0x12')
      await expect(caller.divFix(0, fp(0))).to.be.revertedWith('panic code 0x12')
      await expect(caller.divFix(MAX_INT128, fp(0))).to.be.revertedWith('panic code 0x12')
    })
  })

  describe('toInt', async () => {
    it('correctly converts Fixes to int128', async () => {
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

  describe('toUint', async () => {
    it('correctly converts positive Fixes to uint128', async () => {
      for (let result of fixable_ints) {
        if (result >= 0) {
          expect(await caller.toUint(fp(result)), `fp(${result})`).to.equal(bn(result))
        }
      }
    })
    it('fails on negative Fixes', async () => {
      const table = [-1, fp(MIN_FIX_INT), MIN_INT128, fp(-986349)]
      for (let val of table) {
        await expect(caller.toUint(val), `${val}`).to.be.revertedWith('IntOutOfBounds')
      }
    })
    it('rounds towards zero', async () => {
      const table = [
        [1.1, 1],
        [1.9, 1],
        [1, 1],
        [705811305.5207, 705811305],
        [MAX_FIX_INT, MAX_FIX_INT],
        [9.99999, 9],
      ]
      for (let [input, result] of table) {
        expect(await caller.toUint(fp(input)), `fp(${input})`).to.equal(result)
      }
    })
  })

  describe('round', async () => {
    it('correctly rounds to nearest int', async () => {
      const table = [
        [1.1, 1],
        [-1.1, -1],
        [1.9, 2],
        [-1.9, -2],
        [1, 1],
        [-1, -1],
        [0.1, 0],
        [705811305.5207, 705811306],
        [705811305.207, 705811305],
        [-6536585.939, -6536586],
        [-6536585.439, -6536585],
        [3.4999, 3],
        [-3.4999, -3],
        [3.50001, 4],
        [-3.50001, -4],
        [MAX_FIX_INT, MAX_FIX_INT],
        [MIN_FIX_INT, MIN_FIX_INT],
        [9.99999, 10],
        [-9.99999, -10],
        [6.5, 7],
        [5.5, 6],
        [-6.5, -7],
        [-5.5, -6],
        [0, 0],
        [0.5, 1],
        [-0.5, -1],
      ]
      for (let [input, result] of table) {
        expect(await caller.round(fp(input)), `fp(${input})`).to.equal(result)
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
        table.push([a, b, c], [-a, -b, -c], [b, a, c], [-b, -a, -c], [c, -a, b], [c, -b, a], [-c, a, -b], [-c, b, -a])
      table.push(
        ['1e-18', '2e-18', '3e-18'],
        [MAX_FIX_INT, 0, MAX_FIX_INT],
        [MAX_FIX_INT, MAX_FIX_INT.mul(-1), 0],
        [MAX_FIX_INT.div(8).mul(3), MAX_FIX_INT.div(8).mul(5), MAX_FIX_INT.div(8).mul(8)]
      )
      for (let [a, b, c] of table) expect(await caller.plus(fp(a), fp(b)), `${a} + ${b}`).to.equal(fp(c))
    })
    it('correctly adds at the extremes of its range', async () => {
      expect(await caller.plus(MAX_INT128, -1)).to.equal(MAX_INT128.sub(1))
      expect(await caller.plus(MAX_INT128.sub(1), 1)).to.equal(MAX_INT128)
      expect(await caller.plus(MIN_INT128.add(1), -1)).to.equal(MIN_INT128)
      expect(await caller.plus(MIN_INT128.div(2), MIN_INT128.div(2))).to.equal(MIN_INT128)
      expect(await caller.plus(MAX_INT128, MIN_INT128)).to.equal(-1)
    })
    it('fails outside its range', async () => {
      await expect(caller.plus(MAX_INT128, 1), 'plus(MAX, 1)').to.be.reverted
      const half_max = MAX_INT128.add(1).div(2)
      await expect(caller.plus(half_max, half_max), 'plus((MAX+1)/2, (MAX+1)/2)').to.be.reverted
      await expect(caller.plus(MIN_INT128, -1), 'plus(MIN, -1)').to.be.reverted
      await expect(caller.plus(MIN_INT128.div(2), MIN_INT128.div(2).sub(1)), 'plus(MIN/2, MIN/2 -1)').to.be.reverted
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
      expect(await caller.plusi(MAX_INT128.sub(SCALE.mul(3)), 3), 'plusi(MAX-3, 3)').to.equal(MAX_INT128)
      const max_mantissa = MAX_INT128.mod(SCALE)
      expect(
        await caller.plusi(max_mantissa.sub(fp(12345)), MAX_FIX_INT.add(12345)),
        'plusi(max_mantissa - 12345, MAX_FIX_INT + 12345)'
      ).to.equal(MAX_INT128)

      expect(await caller.plusi(MIN_INT128.add(SCALE.mul(3)), -3), 'plusi(MIN+3, -3)').to.equal(MIN_INT128)
    })

    it('fails outside its range', async () => {
      await expect(caller.plusi(MAX_INT128.sub(SCALE.mul(3)).add(1), 3), 'plusi(MAX-3+eps, 3)').to.be.reverted
      await expect(caller.plusi(MAX_INT128.sub(SCALE.mul(3)), 4), 'plusi(MAX-3, 4)').to.be.reverted
      await expect(caller.plusi(0, MAX_FIX_INT.add(1)), 'plusi(0, MAX_FIX + 1)').to.be.reverted
      await expect(caller.plusi(0, MIN_FIX_INT.sub(1)), 'plusi(0, MIN_FIX - 1)').to.be.reverted
      await expect(caller.plusi(MIN_INT128, -1), 'plusi(MIN, -1)').to.be.reverted
      await expect(caller.plusi(MIN_INT128.add(SCALE.mul(3)).sub(1), -3), 'plusi(MIN+3-eps, -3)').to.be.reverted
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
      expect(await caller.plusu(MAX_INT128.sub(SCALE.mul(3)), 3), 'plusu(MAX-3, 3)').to.equal(MAX_INT128)
      const max_mantissa = MAX_INT128.mod(SCALE)
      expect(
        await caller.plusu(max_mantissa.sub(fp(12345)), MAX_FIX_INT.add(12345)),
        'plusu(max_mantissa - 12345, MAX_FIX_INT + 12345)'
      ).to.equal(MAX_INT128)

      expect(await caller.plusu(MIN_INT128, 0), 'plusu(MIN, 0)').to.equal(MIN_INT128)
    })

    it('fails outside its range', async () => {
      await expect(caller.plusu(MAX_INT128.sub(SCALE.mul(3)).add(1), 3), 'plusu(MAX-3+eps, 3)').to.be.reverted
      await expect(caller.plusu(MAX_INT128.sub(SCALE.mul(3)), 4), 'plusu(MAX-3, 4)').to.be.reverted
      await expect(caller.plusu(0, MAX_FIX_INT.add(1)), 'plusu(0, MAX_FIX + 1)').to.be.reverted
      await expect(caller.plusu(0, MAX_UINT128), 'plusu(0, MAX_UINT)').to.be.reverted
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
        table.push([a, b, c], [-a, -b, -c], [b, a, -c], [-b, -a, c], [a, c, b], [-a, -c, -b], [c, a, -b], [-c, -a, b])
      table.push(
        ['3e-18', '2e-18', '1e-18'],
        [MAX_FIX_INT, 0, MAX_FIX_INT],
        [MAX_FIX_INT, MAX_FIX_INT, 0],
        [MAX_FIX_INT.div(8).mul(5), MAX_FIX_INT.div(8).mul(-3), MAX_FIX_INT.div(8).mul(8)]
      )
      for (let [a, b, c] of table) expect(await caller.minus(fp(a), fp(b)), `${a} + ${b}`).to.equal(fp(c))
    })
    it('correctly subtracts at the extremes of its range', async () => {
      expect(await caller.minus(MAX_INT128, 1)).to.equal(MAX_INT128.sub(1))
      expect(await caller.minus(MAX_INT128.sub(1), -1)).to.equal(MAX_INT128)
      expect(await caller.minus(MIN_INT128.add(1), 1)).to.equal(MIN_INT128)
      expect(await caller.minus(MIN_INT128.div(2), MIN_INT128.div(2).mul(-1))).to.equal(MIN_INT128)
      expect(await caller.minus(MAX_INT128, MAX_INT128)).to.equal(0)
      expect(await caller.minus(MIN_INT128, MIN_INT128)).to.equal(0)
    })
    it('fails outside its range', async () => {
      await expect(caller.minus(MAX_INT128, -1), 'minus(MAX, -1)').to.be.reverted
      const half_max = MAX_INT128.add(1).div(2)
      await expect(caller.minus(half_max, half_max.mul(-1)), 'minus((MAX+1)/2, -(MAX+1)/2)').to.be.reverted
      await expect(caller.minus(MIN_INT128, 1), 'minus(MIN, 1)').to.be.reverted
      const half_min = MIN_INT128.div(2)
      await expect(caller.minus(half_min, half_min.sub(1).mul(-1)), 'minus(MIN/2, -MIN/2 +1)').to.be.reverted
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
      expect(await caller.minusi(MAX_INT128.sub(SCALE.mul(3)), -3), 'minusi(MAX-3, -3)').to.equal(MAX_INT128)
      const max_mantissa = MAX_INT128.mod(SCALE)
      expect(
        await caller.minusi(max_mantissa.sub(fp(12349)), MAX_FIX_INT.add(12349).mul(-1)),
        'minusi(max_mantissa - 12349, -(MAX_FIX_INT + 12349))'
      ).to.equal(MAX_INT128)

      expect(await caller.minusi(MIN_INT128.add(SCALE.mul(7)), 7), 'minusi(MIN+7, 7)').to.equal(MIN_INT128)
    })

    it('fails outside its range', async () => {
      await expect(caller.minusi(MAX_INT128.sub(SCALE.mul(3)).add(1), -3), 'minusi(MAX-3+eps, -3)').to.be.reverted
      await expect(caller.minusi(MAX_INT128.sub(SCALE.mul(3)), -4), 'minusi(MAX-3, -4)').to.be.reverted
      await expect(caller.minusi(0, MAX_FIX_INT.add(1).mul(-1)), 'minusi(0, -(MAX_FIX + 1))').to.be.reverted
      await expect(caller.minusi(0, MIN_FIX_INT.mul(-1).add(1)), 'minusi(0, -MIN_FIX +1)').to.be.reverted
      await expect(caller.minusi(MIN_INT128, 1), 'minusi(MIN, 1)').to.be.reverted
      await expect(caller.minusi(MIN_INT128.add(SCALE.mul(3)).sub(1), 3), 'minusi(MIN+3-eps, 3)').to.be.reverted
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
      expect(await caller.minusu(MIN_INT128.add(SCALE.mul(81)), 81), 'minusu(MIN + 81, 81)').to.equal(MIN_INT128)
      expect(await caller.minusu(MAX_INT128, 0), 'minusu(MAX, 0)').to.equal(MAX_INT128)
      expect(await caller.minusu(MIN_INT128, 0), 'minusu(MIN, 0)').to.equal(MIN_INT128)
    })

    it('fails outside its range', async () => {
      await expect(caller.minusu(MAX_INT128, MAX_FIX_INT.mul(2).add(3)), 'minusu(MAX, MAX_FIX*2+3)').to.be.reverted
      await expect(caller.minusu(MIN_INT128, 1), 'minusu(MIN, 1)').to.be.reverted
      await expect(caller.minusu(0, MAX_FIX_INT.add(1)), 'minusu(0, MAX_FIX + 1)').to.be.reverted
      await expect(caller.minusu(0, MAX_UINT128), 'minusu(0, MAX_UINT)').to.be.reverted
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
        [MAX_INT128, fp(1), MAX_INT128],
        [MIN_INT128, fp(1), MIN_INT128],
        [MIN_INT128.div(256), fp(256), MIN_INT128],
        [MAX_INT128.sub(1).div(2), fp(2), MAX_INT128.sub(1)],
        [MAX_INT128, fp(-1), MIN_INT128.add(1)],
      ]
      for (let [a, b, c] of table) {
        expect(await caller.mul(a, b), `mul(${a}, ${b})`).to.equal(c)
        expect(await caller.mul(b, a), `mul(${b}, ${a})`).to.equal(c)
      }
    })
    it('fails outside its range', async () => {
      await expect(caller.mul(MIN_INT128, fp(-1)), `mul(MIN, -1)`).to.be.reverted
      await expect(caller.mul(MAX_INT128.div(2).add(1), fp(2)), `mul(MAX/2 + 2, 2)`).to.be.reverted
      await expect(caller.mul(fp(bn(2).pow(68)), fp(bn(2).pow(68))), `mul(2^68, 2^68)`).to.be.reverted
      await expect(caller.mul(fp(bn(2).pow(68)).mul(-1), fp(bn(2).pow(68))), `mul(-2^64, 2^64)`).to.be.reverted
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
      for (let [a, b, c] of table) expect(await caller.muli(fp(a), b), `muli(fp(${a}), ${b})`).to.equal(fp(c))
    })
    it('correctly multiplies at the extremes of its range', async () => {
      const table = [
        [MAX_INT128, 1, MAX_INT128],
        [MIN_INT128, 1, MIN_INT128],
        [fp(1), MAX_FIX_INT, fp(MAX_FIX_INT)],
        [MIN_INT128.div(256), 256, MIN_INT128],
        [MAX_INT128.sub(1).div(2), 2, MAX_INT128.sub(1)],
        [MAX_INT128, -1, MIN_INT128.add(1)],
      ]
      for (let [a, b, c] of table) expect(await caller.muli(a, b), `muli(${a}, ${b})`).to.equal(c)
    })
    it('fails outside its range', async () => {
      const table = [
        [MIN_INT128, -1],
        [MAX_INT128.div(2).add(1), 2],
        [fp(bn(2).pow(68)), bn(2).pow(68)],
        [MAX_INT128, MAX_INT128],
        [MAX_INT128, MIN_INT128],
        [MIN_INT128, MAX_INT128],
        [MIN_INT128, MIN_INT128],
      ]
      for (let [a, b, c] of table) await expect(caller.muli(a, b), `muli(${a}, ${b})`).to.be.reverted
    })
  })
  describe('mulu', async () => {
    it('correctly multiplies inside its range', async () => {
      let table = mulu_table.flatMap(([a, b, c]) => [
        [a, b, c],
        [-a, b, -c],
      ])
      for (let [a, b, c] of table) expect(await caller.mulu(fp(a), b), `mulu(fp(${a}), ${b})`).to.equal(fp(c))
    })
    it('correctly multiplies at the extremes of its range', async () => {
      const table = [
        [MAX_INT128, 1, MAX_INT128],
        [MIN_INT128, 1, MIN_INT128],
        [fp(1), MAX_FIX_INT, fp(MAX_FIX_INT)],
        [MIN_INT128.div(256), 256, MIN_INT128],
        [MAX_INT128.sub(1).div(2), 2, MAX_INT128.sub(1)],
        [fp(0.25), bn(2).pow(69), fp(bn(2).pow(67))],
      ]
      for (let [a, b, c] of table) expect(await caller.mulu(a, b), `mulu(${a}, ${b})`).to.equal(c)
    })
    it('fails outside its range', async () => {
      const table = [
        [MAX_INT128.div(2).add(1), 2],
        [fp(bn(2).pow(68)), bn(2).pow(68)],
        [MAX_INT128, MAX_INT128],
        [MIN_INT128, MAX_INT128],
        [fp(1), MAX_UINT128],
        [fp(0.25), bn(2).pow(70)],
      ]
      for (let [a, b, c] of table) await expect(caller.mulu(a, b), `mulu(${a}, ${b})`).to.be.reverted
    })
  })
  describe('div', async () => {})
  describe('divi', async () => {})
  describe('divu', async () => {})
  describe('inv', async () => {})
  describe('powu', async () => {})
  describe('lt', async () => {})
  describe('lte', async () => {})
  describe('gt', async () => {})
  describe('gte', async () => {})
  describe('eq', async () => {})
  describe('neq', async () => {})
  describe('near', async () => {})
})
