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
  const MAX_FIX_INT = MAX_INT128.div(pow10(18)) // biggest integer N st toFix(N) exists
  const MIN_FIX_INT = MIN_INT128.div(pow10(18)) // smallest integer N st toFix(N) exists

  before(async () => {
    ;[owner] = await ethers.getSigners()
    FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  describe('intToFix', async () => {
    it('correctly converts int values', async () => {
      const table = [0, 1, -1, MAX_FIX_INT, MIN_FIX_INT, MAX_FIX_INT.sub(1), MIN_FIX_INT.add(1)]
      for (let input of table) {
        expect(await caller.intToFix(bn(input)), `toFix(${input})`).to.equal(fp(input))
      }
    })
    it('fails on values outside its domain', async () => {
      expect(await caller.intToFix(MAX_FIX_INT.add(1))).to.throw('/VM Exception/')
      expect(await caller.intToFix(MIN_FIX_INT.sub(1))).to.throw('/VM Exception/')
      expect(await caller.intToFix(MAX_FIX_INT.mul(25))).to.throw('/VM Exception/')
      // HERE -- how do I check that the txn correctly reverts?
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
