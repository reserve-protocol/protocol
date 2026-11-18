import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { CollateralStatus, MAX_UINT192, ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { ousdCollateralConfig, ousdRevenueHiding } from '../../common/ousd'

describe('OUSDCollateral', () => {
  async function fixture() {
    const asset = await (
      await ethers.getContractFactory('ERC20Mock')
    ).deploy('Origin Dollar', 'OUSD')
    const vault = await (
      await ethers.getContractFactory('ERC4626Mock')
    ).deploy(asset.address, 18, fp('1.2'))
    const feed = await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    const factory = await ethers.getContractFactory('OUSDCollateral')
    const config = { ...ousdCollateralConfig, erc20: vault.address, chainlinkFeed: feed.address }
    const collateral = await factory.deploy(config, ousdRevenueHiding)
    await collateral.refresh()
    return { asset, vault, feed, factory, config, collateral }
  }

  it('prices the full wrapper ratio at a constant USD peg, with outward-rounded bounds', async () => {
    const { vault, collateral } = await loadFixture(fixture)
    const ratio = fp('1.234567890123456789')
    await vault.setAssetsPerShare(ratio)
    const error = ratio.mul(ousdCollateralConfig.oracleError).add(fp('1').sub(1)).div(fp('1'))
    expect(await collateral.tryPrice()).to.deep.equal([ratio.sub(error), ratio.add(error), fp('1')])
    await collateral.refresh()
    expect(await collateral.savedPegPrice()).to.equal(fp('1'))
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.targetPerRef()).to.equal(fp('1'))
    expect(await collateral.refPerTok()).to.be.lt(ratio)
  })

  for (const [field, value, reason] of [
    ['erc20', ZERO_ADDRESS, 'missing erc20'],
    ['chainlinkFeed', ZERO_ADDRESS, 'missing chainlink feed'],
    ['oracleTimeout', 0, 'oracleTimeout zero'],
    ['priceTimeout', 0, 'price timeout zero'],
    ['oracleError', 0, 'oracle error out of range'],
    ['oracleError', fp('1'), 'oracle error out of range'],
    ['maxTradeVolume', 0, 'invalid max trade volume'],
    ['targetName', ethers.constants.HashZero, 'targetName missing'],
    ['delayUntilDefault', 1209601, 'delayUntilDefault too long'],
  ] as const) {
    it(`rejects invalid ${field}: ${value}`, async () => {
      const { factory, config } = await loadFixture(fixture)
      await expect(
        factory.deploy({ ...config, [field]: value }, ousdRevenueHiding)
      ).to.be.revertedWith(reason)
    })
  }

  it('validates revenue hiding and allows a zero default threshold', async () => {
    const { factory, config, collateral } = await loadFixture(fixture)
    await expect(factory.deploy(config, fp('1'))).to.be.revertedWith('revenueHiding out of range')
    expect(await collateral.pegBottom()).to.equal(fp('1'))
    expect(await collateral.pegTop()).to.equal(fp('1'))
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  })

  it('normalizes different share and underlying decimals', async () => {
    const { factory, config } = await loadFixture(fixture)
    const usdc = await (await ethers.getContractFactory('USDCMock')).deploy('USD Coin', 'USDC')
    const vault = await (
      await ethers.getContractFactory('ERC4626Mock')
    ).deploy(usdc.address, 8, 1234567)
    const collateral = await factory.deploy({ ...config, erc20: vault.address }, 0)
    expect(await collateral.underlyingRefPerTok()).to.equal(fp('1.234567'))
  })

  it('ignores divergent, invalid and stale feed answers', async () => {
    const { collateral, feed } = await loadFixture(fixture)
    const price = await collateral.tryPrice()
    for (const answer of [bn('0'), bn('-1'), bn('1e6'), bn('1e10')]) {
      await feed.updateAnswer(answer)
      await time.increase(ousdCollateralConfig.priceTimeout + 1000)
      await collateral.refresh()
      expect(await collateral.tryPrice()).to.deep.equal(price)
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    }
  })

  it('never calls the configured feed, even when it has no oracle interface', async () => {
    const { factory, config, asset } = await loadFixture(fixture)
    const collateral = await factory.deploy({ ...config, chainlinkFeed: asset.address }, 0)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect((await collateral.tryPrice())[2]).to.equal(fp('1'))
  })

  it('ignores explicit and empty oracle reverts', async () => {
    const { factory, config } = await loadFixture(fixture)
    const feed = await (
      await ethers.getContractFactory('InvalidMockV3Aggregator')
    ).deploy(8, bn('1e8'))
    const collateral = await factory.deploy({ ...config, chainlinkFeed: feed.address }, 0)
    await feed.setRevertWithExplicitError(true)
    await expect(feed.latestRoundData()).to.be.revertedWith('oracle explicit error')
    await collateral.refresh()
    const price = await collateral.price()
    await feed.setSimplyRevert(true)
    await expect(feed.latestRoundData()).to.be.revertedWithoutReason()
    await collateral.refresh()
    expect(await collateral.price()).to.deep.equal(price)
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  })

  it('hides small drawdowns and exposes appreciation', async () => {
    const { collateral, vault } = await loadFixture(fixture)
    const original = await collateral.refPerTok()
    await vault.setAssetsPerShare(fp('1.19994')) // 0.005% drawdown, below 0.01% hiding
    await collateral.refresh()
    expect(await collateral.refPerTok()).to.equal(original)
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    await vault.setAssetsPerShare(fp('1.3'))
    await collateral.refresh()
    expect(await collateral.refPerTok()).to.equal(
      fp('1.3').mul(fp('1').sub(ousdRevenueHiding)).div(fp('1'))
    )
  })

  it('hard-defaults below the exposed ratio and cannot recover', async () => {
    const { collateral, vault } = await loadFixture(fixture)
    await vault.setAssetsPerShare((await collateral.refPerTok()).sub(1))
    await expect(collateral.refresh())
      .to.emit(collateral, 'CollateralStatusChanged')
      .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)
    await vault.setAssetsPerShare(fp('2'))
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
  })

  it('allows zero revenue hiding and defaults on even a one-wei loss', async () => {
    const { factory, config, vault } = await loadFixture(fixture)
    const collateral = await factory.deploy(config, 0)
    await collateral.refresh()
    expect(await collateral.refPerTok()).to.equal(fp('1.2'))
    await vault.setAssetsPerShare(fp('1.2').sub(1))
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
  })

  it('hard-defaults when the wrapper returns zero', async () => {
    const { collateral, vault } = await loadFixture(fixture)
    await vault.setAssetsPerShare(0)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.price()).to.deep.equal([bn(0), bn(0)])
  })

  it('hard-defaults on wrapper failure and decays saved prices to unpriced', async () => {
    const { collateral, vault } = await loadFixture(fixture)
    const saved = await collateral.price()
    const lastSave = Number(await collateral.lastSave())
    await vault.setRevertMode(1)
    await expect(collateral.tryPrice()).to.be.revertedWith('wrapper unavailable')
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.price()).to.deep.equal(saved)
    expect(await collateral.lastSave()).to.equal(lastSave)
    const decayStart = lastSave + ousdCollateralConfig.oracleTimeout + 300
    await time.increaseTo(decayStart + 1000)
    const decaying = await collateral.price()
    expect(decaying[0]).to.be.lt(saved[0])
    expect(decaying[1]).to.be.gt(saved[1])
    await time.increaseTo(decayStart + ousdCollateralConfig.priceTimeout)
    expect(await collateral.price()).to.deep.equal([bn(0), MAX_UINT192])
  })

  it('propagates empty wrapper reverts without changing saved state', async () => {
    const { collateral, vault } = await loadFixture(fixture)
    const lastSave = await collateral.lastSave()
    await vault.setRevertMode(2)
    await expect(collateral.refresh()).to.be.revertedWithoutReason()
    await expect(collateral.price()).to.be.revertedWithoutReason()
    expect(await collateral.lastSave()).to.equal(lastSave)
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  })
})
