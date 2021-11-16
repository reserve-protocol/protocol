import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BN_SCALE_FACTOR } from '../../common/constants'
import { fp, bn } from '../../common/numbers'

import { ContractFactory } from 'ethers'
import { BigNumber, BigNumberish } from 'ethers'
import { FixedCallerMock } from '../../typechain/FixedCallerMock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('In FixLib,', async () => {
  let owner: SignerWithAddress
  let FixedCaller: ContractFactory
  let caller: FixedCallerMock

  before(async () => {
    ;[owner] = await ethers.getSigners()
    FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  describe('powu gas-measuring setup', async () => {
    it('checks small gas costs', async () => {
      await caller.powu_nonview(fp('1.000000001'), bn(2).pow(25).sub(1))
    })
  })
})
