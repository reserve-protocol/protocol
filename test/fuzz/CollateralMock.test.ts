import { expect } from 'chai'
import { ethers } from 'hardhat'
import { fp } from '../../common/numbers'
import { CollateralStatus } from '../../common/constants'
import { advanceTime } from '../utils/time'
import { PriceModelKind, PriceModel } from './common'
import * as sc from '../../typechain' // All smart contract types
import { BigNumberish } from 'ethers'

describe('CollateralMock', () => {
  let token: sc.ERC20Mock

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
      token.address, // erc20_
      fp(1e6), // maxTradeVolume_
      806400, // priceTimeout_
      fp(0.005), // oracleError_
      fp(0.05), // defaultThreshold_
      86400, // delayUntilDefault_
      ethers.utils.formatBytes32String('USD'), // targetName_
      refPerTok, // refPerTokModel_
      targetPerRef, // targetPerRefModel_
      uoaPerTarget, // uoaPerTargetModel_
      deviation, // deviationModel_
      0
    )
  }

  beforeEach(async () => {
    const f: sc.ERC20Mock__factory = await ethers.getContractFactory('ERC20Mock')
    token = await f.deploy('Collateral Token', 'TK')
  })

  const priceAround = async (asset: sc.AssetMock, expected: BigNumberish) => {
    const [low, high] = await asset.price()
    expect(low.add(high).div(2)).to.equal(expected)
  }

  it('has isCollateral() == true', async () => {
    const coll: sc.CollateralMock = await newColl(manualPM, manualPM, manualPM, manualPM)
    expect(await coll.isCollateral()).equal(true)
  })

  it('combines price models ', async () => {
    const coll: sc.CollateralMock = await newColl(manualPM, manualPM, manualPM, manualPM)
    await coll.refresh()
    await priceAround(coll, fp(1))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(1))

    await coll.update(fp(0.5), fp(3), fp(7), fp(0.1))

    await priceAround(coll, fp(1.05))
    expect(await coll.refPerTok()).equal(fp(0.5))
    expect(await coll.targetPerRef()).equal(fp(3))

    await coll.update(fp(2), fp(3), fp(0.5), fp(0.7))

    await priceAround(coll, fp(2.1))
    expect(await coll.refPerTok()).equal(fp(2))
    expect(await coll.targetPerRef()).equal(fp(3))
  })

  it('should default collateral - hard default ', async () => {
    const coll: sc.CollateralMock = await newColl(manualPM, manualPM, manualPM, manualPM)
    await coll.refresh()
    await priceAround(coll, fp(1))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(1))

    await coll.refresh()
    expect(await coll.status()).to.equal(CollateralStatus.SOUND)

    await coll.update(fp(0.5), fp(1), fp(1), fp(1))

    await coll.refresh()
    expect(await coll.status()).to.equal(CollateralStatus.DISABLED)

    await priceAround(coll, fp(0.5))
    expect(await coll.refPerTok()).equal(fp(0.5))
    expect(await coll.targetPerRef()).equal(fp(1))
  })

  it('should default collateral - soft default ', async () => {
    const coll: sc.CollateralMock = await newColl(manualPM, manualPM, manualPM, manualPM)
    await coll.refresh()
    await priceAround(coll, fp(1))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(1))

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

    await priceAround(coll, fp(0.8))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(0.8))

    // Advance time past delayUntildEfault
    await advanceTime(Number(await coll.delayUntilDefault()))
    expect(await coll.status()).to.equal(CollateralStatus.DISABLED)

    // Check final values
    await priceAround(coll, fp(0.8))
    expect(await coll.refPerTok()).equal(fp(1))
    expect(await coll.targetPerRef()).equal(fp(0.8))
  })
})
