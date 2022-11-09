import { expect } from 'chai'
import { ethers } from 'hardhat'
import { fp } from '../../common/numbers'
import { CollateralStatus } from '../../common/constants'
import { advanceTime } from '../utils/time'
import { PriceModelKind, PriceModel, addr } from './common'
import * as sc from '../../typechain' // All smart contract types

describe('CollateralMock', () => {
  let token: sc.ERC20Mock
  let underToken: sc.ERC20Mock

  const manualPM = {
    kind: PriceModelKind.MANUAL,
    curr: fp(1),
    low: fp(0.1),
    high: fp(10),
  }

  async function newColl(
    refPerTok: PriceModel,
    targetPerRef: PriceModel,
    uoaPerTarget: PriceModel,
    deviation: PriceModel
  ): Promise<sc.CollateralMock> {
    const f: sc.CollateralMock__factory = await ethers.getContractFactory('CollateralMock')
    return await f.deploy(
      token.address,
      addr(0), // null reward token
      fp(1e6), // maxTradeVolume
      fp(0.05),
      86400,
      underToken.address,
      ethers.utils.formatBytes32String('USD'),
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

  it('has isCollateral() == true', async () => {
    const coll: sc.CollateralMock = await newColl(manualPM, manualPM, manualPM, manualPM)
    expect(await coll.isCollateral()).equal(true)
  })

  it('combines price models ', async () => {
    const coll: sc.CollateralMock = await newColl(manualPM, manualPM, manualPM, manualPM)
    expect(await coll.strictPrice()).equal(fp(1))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(1))
    expect(await coll.pricePerTarget()).equal(fp(1))

    await coll.update(fp(0.5), fp(3), fp(7), fp(0.1))

    expect(await coll.strictPrice()).equal(fp(1.05))
    expect(await coll.refPerTok()).equal(fp(0.5))
    expect(await coll.targetPerRef()).equal(fp(3))
    expect(await coll.pricePerTarget()).equal(fp(7))

    await coll.update(fp(2), fp(3), fp(0.5), fp(0.7))

    expect(await coll.strictPrice()).equal(fp(2.1))
    expect(await coll.refPerTok()).equal(fp(2))
    expect(await coll.targetPerRef()).equal(fp(3))
    expect(await coll.pricePerTarget()).equal(fp(0.5))
  })

  it('should default collateral - hard default ', async () => {
    const coll: sc.CollateralMock = await newColl(manualPM, manualPM, manualPM, manualPM)
    expect(await coll.strictPrice()).equal(fp(1))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(1))
    expect(await coll.pricePerTarget()).equal(fp(1))

    await coll.refresh()
    expect(await coll.status()).to.equal(CollateralStatus.SOUND)

    await coll.update(fp(0.5), fp(1), fp(1), fp(1))

    await coll.refresh()
    expect(await coll.status()).to.equal(CollateralStatus.DISABLED)

    expect(await coll.strictPrice()).equal(fp(0.5))
    expect(await coll.refPerTok()).equal(fp(0.5))
    expect(await coll.targetPerRef()).equal(fp(1))
    expect(await coll.pricePerTarget()).equal(fp(1))
  })

  it('should default collateral - soft default ', async () => {
    const coll: sc.CollateralMock = await newColl(manualPM, manualPM, manualPM, manualPM)
    expect(await coll.strictPrice()).equal(fp(1))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(1))
    expect(await coll.pricePerTarget()).equal(fp(1))

    await coll.refresh()
    expect(await coll.status()).to.equal(CollateralStatus.SOUND)

    // If price does not change significantly nothing happens
    await coll.update(fp(1), fp(0.99), fp(1), fp(1))
    await coll.refresh()
    expect(await coll.status()).to.equal(CollateralStatus.SOUND)

    // If it loses peg beyond default Threshold
    await coll.update(fp(1), fp(0.8), fp(1), fp(1))
    await coll.refresh()
    expect(await coll.status()).to.equal(CollateralStatus.IFFY)

    expect(await coll.strictPrice()).equal(fp(0.8))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(0.8))
    expect(await coll.pricePerTarget()).equal(fp(1))

    // Advance time past delayUntildEfault
    await advanceTime(Number(await coll.delayUntilDefault()))
    expect(await coll.status()).to.equal(CollateralStatus.DISABLED)

    // Check final values
    expect(await coll.strictPrice()).equal(fp(0.8))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(0.8))
    expect(await coll.pricePerTarget()).equal(fp(1))
  })
})
