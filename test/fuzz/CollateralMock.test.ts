import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { fp } from '../../common/numbers'
import { PriceModelKind, PriceModel } from './common'
import * as sc from '../../typechain' // All smart contract types

describe('CollateralMock', () => {
  let token: sc.ERC20Mock
  let underToken: sc.ERC20Mock

  async function newColl(
    refPerTok: PriceModel,
    targetPerRef: PriceModel,
    uoaPerTarget: PriceModel,
    deviation: PriceModel
  ): Promise<sc.CollateralMock> {
    const f: sc.CollateralMock__factory = await ethers.getContractFactory('CollateralMock')
    return await f.deploy(
      token.address,
      fp(1e6),
      fp(0.05),
      86400,
      priceModel,
      underToken.address,
      'USD',
      refPerTok,
      targetPerRef,
      uoaPerTarget,
      deviation
    )
  }

  beforeEach(async () => {
    {
      const f: sc.ERC20Mock__factory = await ethers.getContractFactory('ERC20Mock')
      token = await f.deploy('Collateral Token', 'TK')
      underToken = await f.deploy('Underlying (Base) Token', 'BASE')
    }
  })
})
