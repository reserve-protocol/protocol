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
      expect(caller.intToFix(MAX_FIX_INT.add(1))).revertedWith('IntOutOfBounds')
      expect(caller.intToFix(MIN_FIX_INT.sub(1))).revertedWith('IntOutOfBounds')
      expect(caller.intToFix(MAX_FIX_INT.mul(25))).revertedWith('IntOutOfBounds')
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
      expect(caller.toFix(MAX_FIX_INT.add(1))).revertedWith('UIntOutOfBounds')
      expect(caller.toFix(MAX_FIX_INT.mul(17))).revertedWith('UIntOutOfBounds')
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
      expect(caller.divFix(MAX_INT128.add(1), fp('1e18'))).revertedWith('IntOutOfBounds')
      expect(caller.divFix(MAX_INT128.div(5), fp('0.199e18'))).revertedWith('IntOutOfBounds')
    })
    it('fails on division by zero', async () => {
      expect(caller.divFix(17, fp(0))).revertedWith('panic code 0x12')
      expect(caller.divFix(0, fp(0))).revertedWith('panic code 0x12')
      expect(caller.divFix(MAX_INT128, fp(0))).revertedWith('panic code 0x12')
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
        expect(caller.toUint(val), `${val}`).revertedWith('IntOutOfBounds')
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
      ]
      let table = []
      for (let [a, b, c] of table_init) table.push([a, b, c], [-a, -b, -c], [b, a, c], [-b, -a, -c])
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
      expect(caller.plus(MAX_INT128, 1)).revertedWith('bounds')
      expect(caller.plus(MAX_INT128.div(2), MAX_INT128.div(2).add(1))).revertedWith('bounds')
      expect(caller.plus(MIN_INT128, -1)).revertedWith('bounds')
      expect(caller.plus(MIN_INT128.div(2), MIN_INT128.div(2).sub(1))).revertedWith('bounds')
    })
  })

  /* Binary functions:
     - Value classes to test:
       - At and around MIN
       - At and around MAX
       - At and around ZERO
  */
})
