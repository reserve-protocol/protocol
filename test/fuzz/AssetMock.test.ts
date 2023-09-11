import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { fp } from '../../common/numbers'
import { PriceModelKind, PriceModel, onePM } from './common'
import * as sc from '../../typechain' // All smart contract types

describe(`PriceModels in AssetMock`, () => {
  let token: sc.ERC20Mock

  async function newAsset(priceModel: PriceModel): Promise<sc.AssetMock> {
    const f: sc.AssetMock__factory = await ethers.getContractFactory(
      'contracts/fuzz/AssetMock.sol:AssetMock'
    )
    return await f.deploy(
      token.address, // erc20
      fp(1e6), // maxTradeVolume
      806400, // priceTimeout
      fp(0.005), // oracleError
      priceModel // model
    )
  }

  beforeEach(async () => {
    {
      const f: sc.ERC20Mock__factory = await ethers.getContractFactory('ERC20Mock')
      token = await f.deploy('ERC20Mock Token', 'MT')
    }
  })

  const priceAround = async (asset: sc.AssetMock, expected: BigNumberish) => {
    const price = await asset.price()
    expect(price[0].add(price[1]).div(2)).to.equal(expected)
  }

  it('does not change prices in CONSTANT mode', async () => {
    const asset: sc.AssetMock = await newAsset({
      kind: PriceModelKind.CONSTANT,
      curr: fp(1.02),
      low: fp(0.9),
      high: fp(1.1),
    })
    await priceAround(asset, fp(1.02))
    await asset.update(fp(0.99))
    await priceAround(asset, fp(1.02))
    await asset.update(0)
    await priceAround(asset, fp(1.02))
  })

  it('returns price 1 from p.m. onePM', async () => {
    const asset: sc.AssetMock = await newAsset(onePM)
    await priceAround(asset, fp(1))
    await asset.update(123)
    await priceAround(asset, fp(1))
    await asset.update(96523976243)
    await priceAround(asset, fp(1))
  })

  it('sets prices as expected in MANUAL mode', async () => {
    const asset: sc.AssetMock = await newAsset({
      kind: PriceModelKind.MANUAL,
      curr: fp(1.02),
      low: fp(0.9),
      high: fp(1.1),
    })
    await priceAround(asset, fp(1.02))
    await asset.update(fp(0.99))
    await priceAround(asset, fp(0.99))
    await asset.update(fp(1.3))
    await priceAround(asset, fp(1.3))
    await asset.update(0)
    await priceAround(asset, 0)

    const big: BigNumber = BigNumber.from(2n ** 191n) // a bit less than max uint192
    await asset.update(big)
    await priceAround(asset, big)
  })

  it('sets arbitrary in-band prices in BAND mode', async () => {
    const asset: sc.AssetMock = await newAsset({
      kind: PriceModelKind.BAND,
      curr: fp(1.02),
      low: fp(0.9),
      high: fp(1.1),
    })
    await priceAround(asset, fp(1.02))

    await asset.update(0) // hit low; implementation-sensitive
    await priceAround(asset, fp(0.9))

    await asset.update(fp(0.2)) // hit high; implementation-sensitive
    await priceAround(asset, fp(1.1))

    await asset.update(fp(98643.8623))
    const [low, high] = await asset.price()
    const avg = low.add(high).div(2)
    expect(avg.gte(fp(0.9))).to.be.true
    expect(avg.lte(fp(1.1))).to.be.true
  })

  it('changes by arbitrary multiplications in WALK mode', async () => {
    const asset: sc.AssetMock = await newAsset({
      kind: PriceModelKind.WALK,
      curr: fp(1),
      low: fp(0.5),
      high: fp(2),
    })
    await priceAround(asset, fp(1))

    await asset.update(0) // hit low; implementation-sensitive
    await priceAround(asset, fp(0.5))

    await asset.update(fp(1.5)) // hit high; implementation-sensitive
    await asset.update(fp(1.5)) // hit high; implementation-sensitive
    await priceAround(asset, fp(2))

    await asset.update(fp(98643.8623))
    const [low, high] = await asset.price()
    const avg = low.add(high).div(2)
    expect(avg.gte(fp(1))).to.be.true
    expect(avg.lte(fp(4))).to.be.true
  })
})
