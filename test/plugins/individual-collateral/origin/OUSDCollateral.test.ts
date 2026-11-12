import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { CollateralStatus } from '../../../../common/constants'
import { fp } from '../../../../common/numbers'
import { ousdCollateralConfig, ousdRevenueHiding } from '../../../../common/ousd'
import { useEnv } from '../../../../utils/env'
import { defaultFixtureNoBasket } from '../../../fixtures'
import { whileImpersonating } from '../../../utils/impersonation'
import { getResetFork } from '../helpers'

const FORK_BLOCK = 22164000
const OUSD = '0x2A8e1E676Ec238d8A992307B495b45B3fEAa5e86'
const OUSD_WHALE = '0x87650d7bbfc3a9f10587d7778206671719d9910d' // Curve OUSD/3CRV pool
const describeFork =
  useEnv('FORK') && useEnv('FORK_NETWORK') === 'mainnet' ? describe : describe.skip

describeFork('OUSDCollateral - mainnet fork', () => {
  before(getResetFork(FORK_BLOCK))

  async function fixture() {
    const [owner, alice] = await ethers.getSigners()
    const wousd = await ethers.getContractAt(
      '@openzeppelin/contracts/interfaces/IERC4626.sol:IERC4626',
      ousdCollateralConfig.erc20
    )
    const ousd = await ethers.getContractAt('IERC20Metadata', OUSD)
    const collateral = await (
      await ethers.getContractFactory('OUSDCollateral')
    ).deploy(ousdCollateralConfig, ousdRevenueHiding)
    await collateral.refresh()

    // Transfer existing OUSD, then wrap through the real ERC4626 interface.
    await whileImpersonating(OUSD_WHALE, async (whale) => {
      await ousd.connect(whale).transfer(alice.address, fp('100'))
    })
    await ousd.connect(alice).approve(wousd.address, fp('100'))
    await wousd.connect(alice).deposit(fp('100'), alice.address)
    return { owner, alice, ousd, wousd, collateral }
  }

  it('matches the real asset, decimals and conversion ratio', async () => {
    const { ousd, wousd, collateral } = await loadFixture(fixture)
    expect(await wousd.asset()).to.equal(OUSD)
    expect(await ousd.decimals()).to.equal(18)
    expect(await wousd.decimals()).to.equal(18)
    const ratio = await wousd.convertToAssets(fp('1'))
    expect(ratio).to.be.gt(fp('1'))
    expect(await collateral.underlyingRefPerTok()).to.equal(ratio)
    const [low, high, peg] = await collateral.tryPrice()
    expect(low).to.be.lt(ratio)
    expect(high).to.be.gt(ratio)
    expect(peg).to.equal(fp('1'))
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  })

  it('transfers real wOUSD atomically', async () => {
    const { owner, alice, wousd } = await loadFixture(fixture)
    await expect(wousd.connect(alice).transfer(owner.address, fp('1'))).to.changeTokenBalances(
      wousd,
      [alice, owner],
      [fp('-1'), fp('1')]
    )
  })

  it('registers wOUSD, issues an RToken and redeems directly to wOUSD', async () => {
    const { owner, alice, wousd, ousd, collateral } = await loadFixture(fixture)
    const { assetRegistry, basketHandler, backingManager, rToken } = await defaultFixtureNoBasket()
    await assetRegistry.connect(owner).register(collateral.address)
    await basketHandler.connect(owner).setPrimeBasket([wousd.address], [fp('1')])
    await basketHandler.connect(owner).refreshBasket()
    await time.increase(Number(await basketHandler.warmupPeriod()) + 1)
    await backingManager.grantRTokenAllowance(wousd.address)
    await wousd.connect(alice).approve(rToken.address, ethers.constants.MaxUint256)

    const startingWousd = await wousd.balanceOf(alice.address)
    const startingOusd = await ousd.balanceOf(alice.address)
    await rToken.connect(alice).issue(fp('10'))
    expect(await rToken.balanceOf(alice.address)).to.equal(fp('10'))
    const backing = await wousd.balanceOf(backingManager.address)
    expect(backing).to.be.gt(0)
    expect(startingWousd.sub(await wousd.balanceOf(alice.address))).to.equal(backing)

    const beforeRedeem = await wousd.balanceOf(alice.address)
    await rToken.connect(alice).redeem(fp('10'))
    const redeemed = (await wousd.balanceOf(alice.address)).sub(beforeRedeem)
    const dust = await wousd.balanceOf(backingManager.address)
    // Reserve rounds issuance up and redemption down, leaving at most 10 wei for 10 RTokens.
    expect(redeemed).to.be.closeTo(backing, 10)
    expect(redeemed.add(dust)).to.equal(backing)
    expect(await rToken.balanceOf(alice.address)).to.equal(0)
    expect(await wousd.balanceOf(alice.address)).to.equal(startingWousd.sub(dust))
    expect(await ousd.balanceOf(alice.address)).to.equal(startingOusd)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
  })
})
