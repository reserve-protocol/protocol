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

  before(async () => {
    ;[owner] = await ethers.getSigners()
    FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  describe('intToFix', async () => {
    it('correctly converts int values', async () => {
      const table = [
        0,
        1,
        -1,
        '38326665875765560393',
        '-01942957121544002253',
        MAX_FIX_INT,
        MIN_FIX_INT,
        MAX_FIX_INT.sub(1),
        MIN_FIX_INT.add(1),
      ]
      for (let input of table) {
        expect(await caller.intToFix(bn(input)), `intToFix(${input})`).to.equal(fp(input))
      }
    })
    it('fails on values outside its domain', async () => {
      await expect(caller.intToFix(MAX_FIX_INT.add(1))).revertedWith('IntOutOfBounds')
      await expect(caller.intToFix(MIN_FIX_INT.sub(1))).revertedWith('IntOutOfBounds')
      await expect(caller.intToFix(MAX_FIX_INT.mul(25))).revertedWith('IntOutOfBounds')
    })
  })

  describe('toFix', async () => {
    it('correctly converts uint values', async () => {
      const table = [0, 1, 2, '38326665875765560393', MAX_FIX_INT.sub(1), MAX_FIX_INT]
      for (let input of table) {
        expect(await caller.toFix(bn(input)), `toFix(${input})`).to.equal(fp(input))
      }
    })

    it('fails on values outside its domain', async () => {
      await expect(caller.toFix(MAX_FIX_INT.add(1))).revertedWith('UIntOutOfBounds')
      await expect(caller.toFix(MAX_FIX_INT.mul(17))).revertedWith('UIntOutOfBounds')
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
    it('fails when results fall outside its domain', async () => {
      await expect(caller.divFix(MAX_INT128.add(1), fp('1e18'))).revertedWith('IntOutOfBounds')
      await expect(caller.divFix(MAX_INT128.div(5), fp('0.199e18'))).revertedWith('IntOutOfBounds')
    })
    it('fails on division by zero', async () => {
      await expect(caller.divFix(17, fp(0))).revertedWith('panic code 0x12')
      await expect(caller.divFix(0, fp(0))).revertedWith('panic code 0x12')
      await expect(caller.divFix(MAX_INT128, fp(0))).revertedWith('panic code 0x12')
    })
  })

  describe('plus', async () => {
    it('commutes with toFix', async () => {
      let a = await caller.toFix(13)
      let b = await caller.toFix(25)
      let c = await caller.toFix(38)
      expect(c).to.equal(await caller.plus(a, b))
    })

    it('works on fractional values', async () => {
      let a = await caller.toFix(fp('0.1'))
      let b = await caller.toFix(fp('0.2'))
      let c = await caller.toFix(fp('0.3'))
      expect(c).to.equal(await caller.plus(a, b))
    })
  })

  /* Binary functions:
     - Value classes to test:
       - At and around MIN
       - At and around MAX
       - At and around ZERO
  */
})
