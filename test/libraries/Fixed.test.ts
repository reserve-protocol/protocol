import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BN_SCALE_FACTOR } from '../../common/constants'
import { bn, fp } from '../../common/numbers'

import { ContractFactory } from 'ethers'
import { BigNumber, BigNumberish } from 'ethers'
import { FixedCallerMock } from '../../typechain/FixedCallerMock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('This test harness', () => {
  it('should pass a corrected test', () => {
    expect(false).not.to.equal(true)
  })
})

describe('In FixLib,', async () => {
  let owner: SignerWithAddress
  let FixedCaller: ContractFactory
  let caller: FixedCallerMock

  before(async () => {
    ;[owner] = await ethers.getSigners()
    FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  describe('toFix', async () => {
    it('correctly converts integer values', async () => {
      const values: (BigNumber | number | string)[] = [0, 1, '1e37']
      for (let v of values) {
        expect(await caller.toFix(bn(v))).to.equal(fp(v))
      }
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
