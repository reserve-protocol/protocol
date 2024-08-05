import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { signERC2612Permit } from 'eth-permit'
import { BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { IConfig, ThrottleParams, MAX_THROTTLE_AMT_RATE } from '../common/configuration'
import { CollateralStatus, MAX_UINT256, ONE_PERIOD, ZERO_ADDRESS } from '../common/constants'
import { expectRTokenPrice, setOraclePrice } from './utils/oracles'
import { bn, fp, toBNDecimals } from '../common/numbers'
import {
  ATokenFiatCollateral,
  CTokenFiatCollateral,
  ERC20Mock,
  ERC1271Mock,
  FacadeTest,
  IAssetRegistry,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIBasketHandler,
  TestIMain,
  TestIRToken,
  USDCMock,
  CTokenMock,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import snapshotGasCost from './utils/snapshotGasCost'
import {
  advanceTime,
  advanceBlocks,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from './utils/time'
import {
  Collateral,
  defaultFixture,
  Implementation,
  IMPLEMENTATION,
  ORACLE_ERROR,
  DECAY_DELAY,
  VERSION,
} from './fixtures'
import { useEnv } from '#/utils/env'
import { mintCollaterals } from './utils/tokens'
import { expectEvents } from '#/common/events'

const BLOCKS_PER_HOUR = bn(300)

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

describe(`RTokenP${IMPLEMENTATION} contract`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let tokens: ERC20Mock[]

  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral
  let basket: Collateral[]
  let rTokenAsset: RTokenAsset

  // Config values
  let config: IConfig

  // Main
  let main: TestIMain
  let rToken: TestIRToken
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      assetRegistry,
      backingManager,
      basket,
      basketHandler,
      config,
      facadeTest,
      main,
      rToken,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    collateral0 = <Collateral>basket[0]
    collateral1 = <Collateral>basket[1]
    collateral2 = <ATokenFiatCollateral>basket[2]
    collateral3 = <CTokenFiatCollateral>basket[3]
    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <USDCMock>await ethers.getContractAt('USDCMock', await collateral1.erc20())
    token2 = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())
    tokens = [token0, token1, token2, token3]

    // Mint initial balances
    initialBal = fp('1e7') // 10x the issuance throttle amount
    await mintCollaterals(owner, [addr1, addr2], initialBal, basket)
  })

  describe('Deployment #fast', () => {
    it('Deployment should setup RToken correctly', async () => {
      expect(await rToken.name()).to.equal('RTKN RToken')
      expect(await rToken.symbol()).to.equal('RTKN')
      expect(await rToken.decimals()).to.equal(18)
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await rToken.basketsNeeded()).to.equal(0)

      // Check RToken price
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))
      await rToken.connect(addr1).issue('1')
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
    })

    it('Should setup the DomainSeparator for Permit correctly', async () => {
      const chainId = await getChainId(hre)
      const _name = await rToken.name()
      const verifyingContract = rToken.address
      expect(await rToken.DOMAIN_SEPARATOR()).to.equal(
        ethers.utils._TypedDataEncoder.hashDomain({
          name: _name,
          version: VERSION,
          chainId,
          verifyingContract,
        })
      )
    })
  })

  describe('Configuration #fast', () => {
    it('Should allow to dissolve RTokens only from BackingManager', async () => {
      await expect(rToken.connect(owner).dissolve(fp('1'))).to.be.revertedWith(
        'not backing manager'
      )
    })

    it('Should allow to set basketsNeeded only from BackingManager', async () => {
      // Check initial status
      expect(await rToken.basketsNeeded()).to.equal(0)

      // Try to update value if not BackingManager
      await expect(rToken.connect(owner).setBasketsNeeded(fp('1'))).to.be.revertedWith(
        'not backing manager'
      )

      await whileImpersonating(assetRegistry.address, async (bhSigner) => {
        await expect(rToken.connect(bhSigner).setBasketsNeeded(fp('1'))).to.be.revertedWith(
          'not backing manager'
        )
      })
    })

    it('Should not allow to setBasketsNeeded at 0 supply', async () => {
      // Should not be able to setBasketsNeeded at 0 supply
      await whileImpersonating(backingManager.address, async (bhSigner) => {
        await expect(rToken.connect(bhSigner).setBasketsNeeded(fp('1'))).to.be.revertedWith(
          '0 supply'
        )
      })
    })

    it('Should allow to update issuance throttle if Owner and perform validations', async () => {
      const issuanceThrottleParams = { amtRate: fp('1'), pctRate: fp('0.1') }
      await expect(
        rToken.connect(addr1).setIssuanceThrottleParams(issuanceThrottleParams)
      ).to.be.revertedWith('governance only')

      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      let params = await rToken.issuanceThrottleParams()
      expect(params[0]).to.equal(issuanceThrottleParams.amtRate)
      expect(params[1]).to.equal(issuanceThrottleParams.pctRate)

      issuanceThrottleParams.amtRate = fp('2')
      issuanceThrottleParams.pctRate = fp('1')
      await expect(rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams))
      params = await rToken.issuanceThrottleParams()
      expect(params[0]).to.equal(issuanceThrottleParams.amtRate)
      expect(params[1]).to.equal(issuanceThrottleParams.pctRate)

      // Cannot update with too small amtRate
      issuanceThrottleParams.amtRate = fp('1').sub(1)
      await expect(
        rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      ).to.be.revertedWith('issuance amtRate too small')

      // Cannot update with too big amtRate
      issuanceThrottleParams.amtRate = bn('1e48').add(1)
      await expect(
        rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      ).to.be.revertedWith('issuance amtRate too big')

      // Cannot update with too big pctRate
      issuanceThrottleParams.amtRate = fp('1')
      issuanceThrottleParams.pctRate = fp('1').add(bn('1'))
      await expect(
        rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      ).to.be.revertedWith('issuance pctRate too big')
    })

    it('Should account for accrued value when updating issuance throttle parameters', async () => {
      await advanceTime(12 * 5 * 60) // 60 minutes, charge fully
      const issuanceThrottleParams = { amtRate: fp('60'), pctRate: fp('0.1') }

      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      const params = await rToken.issuanceThrottleParams()
      expect(params[0]).to.equal(issuanceThrottleParams.amtRate)
      expect(params[1]).to.equal(issuanceThrottleParams.pctRate)

      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))
      await rToken.connect(addr1).issue(fp('20'))
      expect(await rToken.issuanceAvailable()).to.equal(fp('40'))

      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12 * 5 * 10) // 10 minutes

      issuanceThrottleParams.amtRate = fp('100')
      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      expect(await rToken.issuanceAvailable()).to.equal(fp('50'))
    })

    it('Should allow to update redemption throttle if Owner and perform validations', async () => {
      const redemptionThrottleParams = { amtRate: fp('1'), pctRate: fp('0.1') }
      await expect(
        rToken.connect(addr1).setRedemptionThrottleParams(redemptionThrottleParams)
      ).to.be.revertedWith('governance only')

      await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
      let params = await rToken.redemptionThrottleParams()
      expect(params[0]).to.equal(redemptionThrottleParams.amtRate)
      expect(params[1]).to.equal(redemptionThrottleParams.pctRate)

      redemptionThrottleParams.amtRate = fp('2')
      redemptionThrottleParams.pctRate = fp('1')
      await expect(rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams))
      params = await rToken.redemptionThrottleParams()
      expect(params[0]).to.equal(redemptionThrottleParams.amtRate)
      expect(params[1]).to.equal(redemptionThrottleParams.pctRate)

      // Cannot update with too small amtRate
      redemptionThrottleParams.amtRate = fp('1').sub(1)
      await expect(
        rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
      ).to.be.revertedWith('redemption amtRate too small')

      // Cannot update with too big amtRate
      redemptionThrottleParams.amtRate = bn('1e48').add(1)
      await expect(
        rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
      ).to.be.revertedWith('redemption amtRate too big')

      // Cannot update with too big pctRate
      redemptionThrottleParams.amtRate = fp('1')
      redemptionThrottleParams.pctRate = fp('1').add(bn('1'))
      await expect(
        rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
      ).to.be.revertedWith('redemption pctRate too big')
    })

    it('Should account for accrued value when updating redemption throttle parameters', async () => {
      await advanceTime(12 * 5 * 60) // 60 minutes, charge fully
      const issuanceThrottleParams = { amtRate: fp('100'), pctRate: fp('0.1') }
      const redemptionThrottleParams = { amtRate: fp('60'), pctRate: fp('0.1') }

      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
      const params = await rToken.redemptionThrottleParams()
      expect(params[0]).to.equal(redemptionThrottleParams.amtRate)
      expect(params[1]).to.equal(redemptionThrottleParams.pctRate)

      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))
      await rToken.connect(addr1).issue(fp('100'))
      expect(await rToken.redemptionAvailable()).to.equal(fp('60'))
      await rToken.connect(addr1).redeem(fp('30'))
      expect(await rToken.redemptionAvailable()).to.equal(fp('30'))

      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12 * 5 * 10) // 10 minutes

      redemptionThrottleParams.amtRate = fp('100')
      await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
      expect(await rToken.redemptionAvailable()).to.equal(fp('40'))
    })

    it('Should return a price of 0 if the assets become unregistered', async () => {
      const startPrice = await basketHandler.price(false)

      expect(startPrice[0]).to.gt(0)
      expect(startPrice[1]).to.gt(0)

      for (let i = 0; i < basket.length; i++) {
        await assetRegistry.connect(owner).unregister(basket[i].address)
      }

      const endPrice = await basketHandler.price(false)

      expect(endPrice[0]).to.eq(0)
      expect(endPrice[1]).to.eq(0)
    })
  })

  describe('Issuance', function () {
    it('Should not issue RTokens if issuance paused', async function () {
      const issueAmount: BigNumber = bn('10e18')

      // Pause Main
      await main.connect(owner).pauseIssuance()

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'frozen or issuance paused'
      )

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should issue RTokens if trading paused', async function () {
      const issueAmount: BigNumber = bn('10e18')

      // Pause Main
      await main.connect(owner).pauseTrading()

      // Issue
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, issueAmount)))
      await rToken.connect(addr1).issue(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
    })

    it('Should not issue RTokens if frozen', async function () {
      const issueAmount: BigNumber = bn('10e18')

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'frozen or issuance paused'
      )

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not issue RTokens if UNPRICED collateral', async function () {
      const issueAmount: BigNumber = bn('10e18')

      await advanceTime(DECAY_DELAY.toString())

      // Start issuance pre-pause
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, issueAmount)))

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith('basket not ready')

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not issue RTokens if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Try to issue
      await expect(rToken.connect(addr1).issue(zero)).to.be.revertedWith('Cannot issue zero')

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn('0'))
    })

    it('Should not allow overflow issuance -- regression test for C4 truncation bug', async function () {
      // Max out issuance throttle
      await rToken
        .connect(owner)
        .setIssuanceThrottleParams({ amtRate: MAX_THROTTLE_AMT_RATE, pctRate: 0 })

      // Try to issue
      await expect(rToken.connect(addr1).issue(MAX_THROTTLE_AMT_RATE.add(1))).to.be.revertedWith(
        'supply change throttled'
      )

      // Check values
      expect(await rToken.totalSupply()).to.equal(0)
      expect(await rToken.basketsNeeded()).to.equal(0)

      // Issue under limit, ensure correct number of baskets is set and we do not overflow
      await mintCollaterals(owner, [addr1], MAX_THROTTLE_AMT_RATE, basket)
      await Promise.all(
        tokens.map((t) => t.connect(addr1).approve(rToken.address, MAX_THROTTLE_AMT_RATE))
      )
      // advance time
      await advanceTime(12 * 5 * 60) // 60 minutes, charge fully
      await rToken.connect(addr1).issue(MAX_THROTTLE_AMT_RATE)
      expect(await rToken.totalSupply()).to.equal(MAX_THROTTLE_AMT_RATE)
      expect(await rToken.basketsNeeded()).to.equal(MAX_THROTTLE_AMT_RATE)
    })

    it('Should not overflow  BU exchange rate below 1e-9 on issue', async () => {
      const issueAmount: BigNumber = fp('1')

      // Set single basket token for simplification
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount))
        .to.emit(rToken, 'Issuance')
        .withArgs(addr1.address, addr1.address, issueAmount, issueAmount)

      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // setBasketsNeeded()
      await whileImpersonating(backingManager.address, async (signer) => {
        await rToken.connect(signer).setBasketsNeeded(bn('1e9'))
      })

      // Issue rTokens successfully
      await expect(rToken.connect(addr1).issue(1)).to.not.be.reverted
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const issueAmount: BigNumber = bn('10e18')

      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: insufficient allowance'
      )
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should revert if user does not have the required Tokens', async function () {
      const issueAmount: BigNumber = config.issuanceThrottle.amtRate

      await token0.connect(other).approve(rToken.address, issueAmount)
      await token1.connect(other).approve(rToken.address, issueAmount)
      await token2.connect(other).approve(rToken.address, issueAmount)
      await token3.connect(other).approve(rToken.address, issueAmount)

      await expect(rToken.connect(other).issue(issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
      expect(await rToken.totalSupply()).to.equal(bn('0'))
    })

    it('Should allow issuances to a different account - issueTo', async function () {
      const issueAmount: BigNumber = config.issuanceThrottle.amtRate

      // Provide approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Issue rTokens to another account
      await expect(rToken.connect(addr1).issueTo(addr2.address, issueAmount))
        .to.emit(rToken, 'Issuance')
        .withArgs(addr1.address, addr2.address, issueAmount, issueAmount)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmount)
    })

    it('Should still issue if melting must be skipped', async () => {
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))
      await rToken.connect(addr1).issue(config.issuanceThrottle.amtRate)
      expect(await rToken.totalSupply()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.basketsNeeded()).to.equal(config.issuanceThrottle.amtRate)
    })

    it('Should issue RTokens with single basket token', async function () {
      const issueAmount: BigNumber = config.issuanceThrottle.amtRate

      // Set basket
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // RToken price pre-issuance
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)

      // check balances before
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Full issuance available, nothing can be redeemed
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount))
        .to.emit(rToken, 'Issuance')
        .withArgs(addr1.address, addr1.address, issueAmount, issueAmount)

      // check balances after
      expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount))
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Check asset value
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

      // Check all available issuance consumed
      expect(await rToken.issuanceAvailable()).to.equal(bn(0))
      // All can be redeemed
      expect(await rToken.redemptionAvailable()).to.equal(config.redemptionThrottle.amtRate)
    })

    it('Should revert if single issuance exceeds maximum allowed', async function () {
      const issueAmount: BigNumber = config.issuanceThrottle.amtRate.add(1)

      // Set basket
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)

      // check balances before
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Full issuance available, nothing can be redeemed
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'supply change throttled'
      )

      // check balances after (no changes)
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Issuance available remains full. Still nothing to redeem
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))
    })

    it('Should return fully discounted price after full basket refresh', async () => {
      const issueAmount: BigNumber = config.issuanceThrottle.amtRate

      // Set basket - Single token
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // RToken price pre-issuance
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Perform a basket switch
      // Set basket - Single token
      await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Should expect maxTradeSlippage + dust losses -- remember no over-collateralization
      // available
      // maxTradeSlippage + dust losses
      // Recall the shortfall is calculated against high prices
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
    })

    it('Should allow multiple issuances in the same block', async function () {
      // Provide approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Full issuance available
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Issuance #1 -  Will be processed in 1 blocks
      const issueAmount: BigNumber = config.issuanceThrottle.amtRate.div(2)
      await rToken.connect(addr1).issue(issueAmount)

      // Issuance #2 - Should be processed in the same block
      await rToken.connect(addr1).issue(issueAmount)

      // Mine block
      await advanceBlocks(1)

      // Check all available issuance consumed. All can be redeemed.
      expect(await rToken.issuanceAvailable()).to.equal(bn(0))
      expect(await rToken.redemptionAvailable()).to.equal(config.issuanceThrottle.amtRate)

      // Check issuances are confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.mul(2))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount.mul(2)
      )

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])
    })

    it('Should apply warmup period on issuance', async function () {
      const issueAmount: BigNumber = bn('10e18')
      const warmupPeriod = bn('259200') // 3 days

      // Set warmup period
      await basketHandler.connect(owner).setWarmupPeriod(warmupPeriod)

      // Start issuance
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, issueAmount)))

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith('basket not ready')

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))

      // Move past warmup period
      await advanceTime(warmupPeriod.toString())

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.not.be.reverted

      // Check values - rTokens issued
      expect(await rToken.totalSupply()).to.equal(issueAmount)
    })

    it('Should use warmup period on issuance after regaining SOUND', async function () {
      const issueAmount: BigNumber = bn('10e18')
      const warmupPeriod = bn('259200') // 3 days

      // Set warmup period and move time forward
      await basketHandler.connect(owner).setWarmupPeriod(warmupPeriod)
      await advanceTime(warmupPeriod.toString())

      // Set collateral and basket status to IFFY to prevent issuance
      await setOraclePrice(collateral1.address, bn('0.5e8'))
      await assetRegistry.refresh()

      // Collateral and basket in IFFY
      expect(await collateral1.status()).to.equal(CollateralStatus.IFFY)
      expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

      // Start issuance
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, issueAmount)))

      // Try to issue, reverts because basket is not SOUND
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith('basket not ready')

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))

      // Set collateral and basket status to SOUND again
      await setOraclePrice(collateral1.address, bn('1e8'))
      await collateral1.refresh()

      // Collateral and basket in SOUND
      expect(await collateral1.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Need to track status in BH to record timestamp on when SOUND was regained
      await basketHandler.trackStatus()

      // Try to issuem still cannot issue due to warmup period
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith('basket not ready')

      // Move past warmup period
      await advanceTime(warmupPeriod.toString())

      // Should be able to issue now
      await expect(rToken.connect(addr1).issue(issueAmount)).to.not.be.reverted

      // Check values - rTokens issued
      expect(await rToken.totalSupply()).to.equal(issueAmount)
    })

    it('Should handle issuance throttle correctly', async function () {
      const rechargePerBlock = config.issuanceThrottle.amtRate.div(BLOCKS_PER_HOUR)

      // Provide approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Full issuance available. Nothing to redeem.
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))

      // Issuance #1 -  Will be processed
      const issueAmount1: BigNumber = bn('100e18')
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount1)

      // Check issuance throttle updated
      expect(await rToken.issuanceAvailable()).to.equal(
        config.issuanceThrottle.amtRate.sub(issueAmount1)
      )

      // Redemption throttle updated
      expect(await rToken.redemptionAvailable()).to.equal(issueAmount1)

      // Issuance #2 - Should be processed
      const issueAmount2: BigNumber = bn('400e18')
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount2)

      // Check issuance throttle updated, previous issuance recharged
      // (the previous issuance was below the 3.3K that gets added in every block)
      expect(await rToken.issuanceAvailable()).to.equal(
        config.issuanceThrottle.amtRate.sub(issueAmount2)
      )

      // Redemption throttle updated
      expect(await rToken.redemptionAvailable()).to.equal(issueAmount1.add(issueAmount2))

      // Issuance #3 - Should be processed
      const issueAmount3: BigNumber = bn('50000e18')
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount3)

      // Check issuance throttle updated - Previous issuances recharged
      expect(await rToken.issuanceAvailable()).to.equal(
        config.issuanceThrottle.amtRate.sub(issueAmount3)
      )

      // Redemption throttle updated
      expect(await rToken.redemptionAvailable()).to.equal(
        issueAmount1.add(issueAmount2).add(issueAmount3)
      )

      // Issuance #4 - Should be processed
      const issueAmount4: BigNumber = bn('100000e18')
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount4)

      // Check issuance throttle updated - we got the 3.3K from the recharge
      expect(await rToken.issuanceAvailable()).to.equal(
        config.issuanceThrottle.amtRate.sub(issueAmount3).add(rechargePerBlock).sub(issueAmount4)
      )

      // Redemption throttle updated
      expect(await rToken.redemptionAvailable()).to.equal(
        issueAmount1.add(issueAmount2).add(issueAmount3).add(issueAmount4)
      )

      // Check all issuances are confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(
        issueAmount1.add(issueAmount2).add(issueAmount3).add(issueAmount4)
      )
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount1.add(issueAmount2).add(issueAmount3).add(issueAmount4)
      )
    })

    it('Should handle issuance throttle correctly, using percent', async function () {
      // Provide approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Full issuance available. Nothing to redeem
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))

      // Issuance #1 -  Will be processed
      const issueAmount1: BigNumber = config.issuanceThrottle.amtRate
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount1)

      // Check issuance throttle updated
      expect(await rToken.issuanceAvailable()).to.equal(
        config.issuanceThrottle.amtRate.sub(issueAmount1)
      )

      // Check redemption throttle updated
      expect(await rToken.redemptionAvailable()).to.equal(issueAmount1)

      // Advance time significantly
      await advanceTime(1000000000)

      // Check new issuance available - fully recharged
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

      // Issuance #2 - Will be processed
      const issueAmount2: BigNumber = config.issuanceThrottle.amtRate
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount2)

      // Check new issuance available - al consumed
      expect(await rToken.issuanceAvailable()).to.equal(bn(0))

      // Check redemption throttle updated - fixed in max (does not exceed)
      expect(await rToken.redemptionAvailable()).to.equal(config.redemptionThrottle.amtRate)

      // Set supply limit only
      const issuanceThrottleParams = { amtRate: fp('1'), pctRate: config.issuanceThrottle.pctRate }
      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)

      // Advance time significantly
      await advanceTime(1000000000)
      // Check new issuance available - 5% of supply (2 M) = 100K
      const supplyThrottle = bn('100000e18')
      expect(await rToken.issuanceAvailable()).to.equal(supplyThrottle)

      // Issuance #3 - Should be rejected, beyond allowed supply
      await expect(rToken.connect(addr1).issue(supplyThrottle.add(1))).to.be.revertedWith(
        'supply change throttled'
      )

      // Check redemption throttle unchanged
      expect(await rToken.redemptionAvailable()).to.equal(config.redemptionThrottle.amtRate)

      // Issuance #3 - Should be allowed, does not exceed supply restriction
      const issueAmount3: BigNumber = bn('50000e18')
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount3)

      // Check issuance throttle updated - Previous issuances recharged
      expect(await rToken.issuanceAvailable()).to.equal(supplyThrottle.sub(issueAmount3))

      // Check redemption throttle unchanged
      expect(await rToken.redemptionAvailable()).to.equal(config.redemptionThrottle.amtRate)

      // Check all issuances are confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(
        issueAmount1.add(issueAmount2).add(issueAmount3)
      )
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount1.add(issueAmount2).add(issueAmount3)
      )
    })

    it('Should allow zero-value amtPct', async function () {
      const issuanceThrottle = JSON.parse(JSON.stringify(config.issuanceThrottle))
      issuanceThrottle.pctRate = 0
      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottle)

      // Provide approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Full issuance available. Nothing to redeem.
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))

      // One above should fail
      await expect(
        rToken.connect(addr1).issue(config.issuanceThrottle.amtRate.add(1))
      ).to.be.revertedWith('supply change throttled')

      // Issuance -  Will be processed
      await rToken.connect(addr1).issue(config.issuanceThrottle.amtRate)

      // Check issuance confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(config.issuanceThrottle.amtRate)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        config.issuanceThrottle.amtRate
      )
    })

    it('Should revert on second issuance if issuance throttle is depleted', async function () {
      // Provide approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Issuance #1 -  Will succeed
      const issueAmount: BigNumber = await rToken.issuanceAvailable()
      await rToken.connect(addr1).issue(issueAmount)

      // Issuance #2 - Will fail
      const newIssueAmount: BigNumber = bn('1')
      await rToken.connect(addr1).issue(newIssueAmount)

      // Mine block
      await hre.network.provider.send('evm_mine', [])

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])

      // Check first issuance succedeed and second did not
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
    })

    it('Should update issuance throttle correctly with redemptions - edge case', async function () {
      // set fixed redemption amount
      const redemptionThrottleParams = JSON.parse(JSON.stringify(config.redemptionThrottle))
      redemptionThrottleParams.amtRate = fp('1e6')
      redemptionThrottleParams.pctRate = bn(0)
      await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)

      // Provide approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Issuance throttle is fully charged
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Issuance #1 - Full available - Will succeed
      const fullIssuanceAmount: BigNumber = await rToken.issuanceAvailable()
      await rToken.connect(addr1).issue(fullIssuanceAmount)

      // Redemption #1 - Full amount
      await rToken.connect(addr1).redeem(fullIssuanceAmount)

      // Issuance #2 - Less than max - Will succeed
      await rToken.connect(addr1).issue(fullIssuanceAmount.div(2))

      // Mine block
      await hre.network.provider.send('evm_mine', [])

      // Issuance and redemption throttle still available for remainder
      expect(await rToken.issuanceAvailable()).to.equal(fullIssuanceAmount.div(2))
      expect(await rToken.redemptionAvailable()).to.equal(fullIssuanceAmount.div(2))

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])
    })
  })

  describe('Redeem', function () {
    it('Should revert if zero amount #fast', async function () {
      const zero: BigNumber = bn('0')
      await expect(rToken.connect(addr1).redeem(zero)).to.be.revertedWith('Cannot redeem zero')
    })

    it('Should revert if no balance of RToken #fast', async function () {
      const redeemAmount: BigNumber = bn('20000e18')

      await expect(rToken.connect(addr1).redeem(redeemAmount)).to.be.revertedWith(
        'insufficient balance'
      )
    })

    context('With issued RTokens', function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')
        // Provide approvals
        await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)
      })

      it('Should redeem RTokens correctly', async function () {
        const redeemAmount = bn('100e18')

        // Check balances
        expect(await rToken.balanceOf(addr1.address)).to.equal(redeemAmount)
        expect(await rToken.totalSupply()).to.equal(redeemAmount)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

        // Redeem rTokens
        await rToken.connect(addr1).redeem(redeemAmount)

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        await Promise.all(
          tokens.map(async (t) => {
            expect(await t.balanceOf(addr1.address)).to.equal(initialBal)
          })
        )

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.sub(redeemAmount)
        )
      })

      it('Should redeem to a different account - redeemTo', async function () {
        // Provide approvals
        await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

        // Redeem rTokens to another account
        await expect(rToken.connect(addr1).redeemTo(addr2.address, issueAmount))
          .to.emit(rToken, 'Redemption')
          .withArgs(addr1.address, addr2.address, issueAmount, issueAmount)
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(addr2.address)).to.equal(0)
        expect(await token0.balanceOf(addr2.address)).to.equal(initialBal.add(issueAmount.div(4)))
      })

      it('Should redeem RTokens correctly for multiple users', async function () {
        const issueAmount = bn('100e18')
        const redeemAmount = bn('100e18')

        // Issue new RTokens
        await Promise.all(tokens.map((t) => t.connect(addr2).approve(rToken.address, initialBal)))

        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

        // Issue rTokens
        await rToken.connect(addr2).issue(issueAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )

        // Redeem rTokens
        await rToken.connect(addr1).redeem(redeemAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2).sub(redeemAmount)
        )

        // Redeem rTokens with another user
        await rToken.connect(addr2).redeem(redeemAmount)

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(addr2.address)).to.equal(0)

        expect(await rToken.totalSupply()).to.equal(0)

        await Promise.all(
          tokens.map(async (t) => {
            expect(await t.balanceOf(addr1.address)).to.equal(initialBal)
            expect(await t.balanceOf(addr2.address)).to.equal(initialBal)
          })
        )

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2).sub(redeemAmount.mul(2))
        )
      })

      it('Should redeem if basket is IFFY #fast', async function () {
        // Default one of the tokens - 50% price reduction and mark default as probable
        await setOraclePrice(collateral3.address, bn('0.5e8'))

        await rToken.connect(addr1).redeem(issueAmount)
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should redeem if basket is UNPRICED #fast', async function () {
        await advanceTime(DECAY_DELAY.toString())

        await rToken.connect(addr1).redeem(issueAmount)
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should handle an extremely small redeem #fast', async function () {
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

        const reedemAmt = bn(10)

        // Skips transfers for tokens with less than 18 decimals
        await expectEvents(rToken.connect(addr1).redeem(reedemAmt), [
          {
            contract: token0,
            name: 'Transfer',
            emitted: true,
          },
          {
            contract: token1,
            name: 'Transfer',
            emitted: false,
          },
          {
            contract: token2,
            name: 'Transfer',
            emitted: true,
          },
          {
            contract: token3,
            name: 'Transfer',
            emitted: false,
          },
        ])

        // Checkbalances
        expect(await rToken.totalSupply()).to.equal(issueAmount.sub(reedemAmt))
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(reedemAmt))
      })

      it('Should redeem if paused #fast', async function () {
        await main.connect(owner).pauseTrading()
        await main.connect(owner).pauseIssuance()
        await rToken.connect(addr1).redeem(issueAmount)
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should revert if frozen #fast', async function () {
        await main.connect(owner).freezeShort()

        // Try to redeem
        await expect(rToken.connect(addr1).redeem(issueAmount)).to.be.revertedWith('frozen')

        // Check values
        expect(await rToken.totalSupply()).to.equal(issueAmount)
      })

      it('Should revert if undercollateralized from missing balance #fast', async function () {
        await token0.connect(owner).burn(backingManager.address, issueAmount.div(4))
        await expect(rToken.connect(addr1).redeem(issueAmount.div(2))).to.be.revertedWith(
          'partial redemption; use redeemCustom'
        )
      })

      it('Should revert if undercollateralized from refPerTok decrease #fast', async function () {
        // Default immediately
        await token2.setExchangeRate(fp('0.1')) // 90% decrease

        // Even though a single BU requires 10x token2 as before, it should still hand out evenly

        // 1st redemption
        await expect(rToken.connect(addr1).redeem(issueAmount.div(2))).be.revertedWith(
          'partial redemption; use redeemCustom'
        )
      })

      it('Should not redeem() unregistered collateral #fast', async function () {
        // Unregister collateral2
        await assetRegistry.connect(owner).unregister(collateral2.address)

        await expect(rToken.connect(addr1).redeem(issueAmount)).revertedWith(
          'partial redemption; use redeemCustom'
        )
      })

      it('Should not overflow BU exchange rate above 1e9 on redeem', async function () {
        // Leave only 1 RToken issue
        await rToken.connect(addr1).redeem(issueAmount.sub(bn('1e18')))

        expect(await rToken.totalSupply()).to.equal(fp('1'))

        // setBasketsNeeded()
        await whileImpersonating(backingManager.address, async (signer) => {
          await rToken.connect(signer).setBasketsNeeded(fp('1e9'))
        })

        // Add extra backing
        await token0.mint(
          backingManager.address,
          fp('1e9').mul(await token0.balanceOf(backingManager.address))
        )
        await token1.mint(
          backingManager.address,
          fp('1e9').mul(await token1.balanceOf(backingManager.address))
        )
        await token2.mint(
          backingManager.address,
          fp('1e9').mul(await token2.balanceOf(backingManager.address))
        )
        await token3.mint(
          backingManager.address,
          fp('1e9').mul(await token3.balanceOf(backingManager.address))
        )

        const redeemAmount: BigNumber = bn('1.5e9')

        // Redeem rTokens successfully
        await expect(rToken.connect(addr1).redeem(bn(redeemAmount))).to.not.be.reverted
      })

      it('Should behave correctly after basket change', async function () {
        // New prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])
        expect(await basketHandler.fullyCollateralized()).to.equal(true) // ref basket hasn't changed

        // Should be able to redeem through both main flow and custom flow
        await rToken.connect(addr1).redeem(fp('1'))
        await rToken
          .connect(addr1)
          .redeemCustom(addr1.address, fp('1'), [await basketHandler.nonce()], [fp('1')], [], [])

        // Cannot redeem after new reference basket
        await basketHandler.refreshBasket()
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expect(rToken.connect(addr1).redeem(1)).to.be.revertedWith(
          'partial redemption; use redeemCustom'
        )

        // Can redeemCustom at latest basket nonce
        const nonce = await basketHandler.nonce()
        await rToken.connect(addr1).redeemCustom(addr1.address, fp('1'), [nonce], [fp('1')], [], [])

        // Can redeemCustom at previous basket nonce
        await rToken
          .connect(addr1)
          .redeemCustom(addr1.address, fp('1'), [nonce - 1], [fp('1')], [], [])

        // Cannot redeemCustom at future basket nonce
        await expect(
          rToken.connect(addr1).redeemCustom(addr1.address, fp('1'), [nonce + 1], [fp('1')], [], [])
        ).to.be.revertedWith('invalid basketNonce')
      })

      context('And redemption throttling', function () {
        // the fixture-configured redemption throttle uses 5%
        let redemptionThrottleParams: ThrottleParams
        let redeemAmount: BigNumber

        beforeEach(async function () {
          redemptionThrottleParams = {
            amtRate: fp('2'), // 2 RToken,
            pctRate: fp('0.1'), // 10%
          }
          await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
          const params = await rToken.redemptionThrottleParams()
          expect(params[0]).to.equal(redemptionThrottleParams.amtRate)
          expect(params[1]).to.equal(redemptionThrottleParams.pctRate)

          // Charge throttle
          await advanceTime(3600)
        })

        it('Should calculate redemption limit correctly', async function () {
          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)
        })

        it('Should be able to do geometric redemptions to scale down supply', async function () {
          // Should complete is just under 30 iterations at rates: 10% + 1e18
          const numIterations = 30
          for (let i = 0; i < numIterations; i++) {
            const totalSupply = await rToken.totalSupply()
            if (totalSupply.eq(0)) break

            // Charge + redeem
            await advanceTime(3600)
            redeemAmount = await rToken.redemptionAvailable()

            await rToken.connect(addr1).redeem(redeemAmount)
            issueAmount = issueAmount.sub(redeemAmount)
            expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
            expect(await rToken.totalSupply()).to.equal(issueAmount)

            // Should reach dust supply before exhausting loop iterations
            expect(i < numIterations - 1).to.equal(true)
          }

          expect(await rToken.totalSupply()).to.equal(0)
        })

        it('Should revert on overly-large redemption #fast', async function () {
          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)

          // Check issuance throttle - full
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          await expect(rToken.connect(addr1).redeem(redeemAmount.add(1))).to.be.revertedWith(
            'supply change throttled'
          )
          await rToken.connect(addr1).redeem(redeemAmount)

          // Check updated redemption throttle
          expect(await rToken.redemptionAvailable()).to.equal(bn(0))

          // Check issuance throttle - remains
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
        })

        it('Should support 1e48 amtRate throttles', async function () {
          const throttles = JSON.parse(JSON.stringify(config.redemptionThrottle))
          throttles.amtRate = bn('1e48')
          await rToken.connect(owner).setIssuanceThrottleParams(throttles)
          await rToken.connect(owner).setRedemptionThrottleParams(throttles)

          // Mint collateral
          await token0.mint(addr1.address, throttles.amtRate)
          await token1.mint(addr1.address, throttles.amtRate)
          await token2.mint(addr1.address, throttles.amtRate)
          await token3.mint(addr1.address, throttles.amtRate)

          // Provide approvals
          await Promise.all(
            tokens.map((t) => t.connect(addr1).approve(rToken.address, MAX_UINT256))
          )

          // Charge throttle
          await advanceTime(3600)
          expect(await rToken.issuanceAvailable()).to.equal(throttles.amtRate)

          // Issue
          await rToken.connect(addr1).issue(throttles.amtRate)
          expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(throttles.amtRate))

          // Redeem
          expect(await rToken.redemptionAvailable()).to.equal(throttles.amtRate)
          await rToken.connect(addr1).redeem(throttles.amtRate)
          expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
        })

        it('Should use amtRate if pctRate is zero', async function () {
          redeemAmount = redemptionThrottleParams.amtRate
          redemptionThrottleParams.pctRate = bn(0)
          await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)

          // Large redemption should fail
          await expect(rToken.connect(addr1).redeem(redeemAmount.add(1))).to.be.revertedWith(
            'supply change throttled'
          )

          // amtRate redemption should succeed
          await expect(rToken.connect(addr1).redeem(redeemAmount)).to.emit(rToken, 'Redemption')

          // Check redemption throttle is 0
          expect(await rToken.redemptionAvailable()).to.equal(bn(0))
        })

        it('Should throttle after allowing two redemptions of half value #fast', async function () {
          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          // Check redemption throttle
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)

          // Issuance throttle is fully charged
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #1
          await rToken.connect(addr1).redeem(redeemAmount.div(2))

          // Check redemption throttle updated
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount.div(2))

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #2
          await rToken.connect(addr1).redeem(redeemAmount.div(2))

          // Check redemption throttle updated - very small
          expect(await rToken.redemptionAvailable()).to.be.closeTo(fp('0.002638'), fp('0.000001'))

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #3 - should not be processed
          await expect(rToken.connect(addr1).redeem(redeemAmount.div(100))).to.be.revertedWith(
            'supply change throttled'
          )

          // Advance time significantly
          await advanceTime(10000000000)

          // Check redemption throttle recharged
          const balance = issueAmount.sub(redeemAmount)
          const redeemAmountUpd = balance.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmountUpd)

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
        })

        it('Should handle redemption throttle correctly, using only amount', async function () {
          // Check initial balance
          expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

          // set fixed amount
          redemptionThrottleParams.amtRate = fp('25')
          redemptionThrottleParams.pctRate = bn(0)
          await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)

          // advance time
          await advanceTime(12 * 5 * 60) // 60 minutes, charge fully

          // Check redemption throttle
          expect(await rToken.redemptionAvailable()).to.equal(redemptionThrottleParams.amtRate)

          // Issuance throttle is fully charged
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #1 -  Will be processed
          redeemAmount = fp('12.5')
          await rToken.connect(addr1).redeem(redeemAmount)

          // Check redemption throttle updated
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Attempt to redeem max amt, should not be processed
          await expect(
            rToken.connect(addr1).redeem(redemptionThrottleParams.amtRate)
          ).to.be.revertedWith('supply change throttled')

          // Advance one hour. Redemption should be fully rechardged
          await advanceTime(3600)

          // Check redemption throttle updated
          expect(await rToken.redemptionAvailable()).to.equal(redemptionThrottleParams.amtRate)

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #2 - will be processed
          await rToken.connect(addr1).redeem(redemptionThrottleParams.amtRate)

          // Check redemption throttle emptied
          expect(await rToken.redemptionAvailable()).to.equal(bn(0))

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Check redemptions processed successfully
          expect(await rToken.balanceOf(addr1.address)).to.equal(
            issueAmount.sub(redeemAmount).sub(redemptionThrottleParams.amtRate)
          )
        })

        it('Should update issuance throttle correctly on redemption', async function () {
          const rechargePerBlock = config.issuanceThrottle.amtRate.div(BLOCKS_PER_HOUR)

          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          // Check redemption throttle
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)

          // Issuance throttle is fully charged
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Issue all available
          await rToken.connect(addr1).issue(config.issuanceThrottle.amtRate)

          // Issuance throttle empty
          expect(await rToken.issuanceAvailable()).to.equal(bn(0))

          // Redemption allowed increase
          const redeemAmountUpd = issueAmount
            .add(config.issuanceThrottle.amtRate)
            .mul(redemptionThrottleParams.pctRate)
            .div(fp('1'))
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmountUpd)

          // Redeem #1 -  Will be processed
          redeemAmount = fp('10000')
          await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
          await rToken.connect(addr1).redeem(redeemAmount)

          // Check redemption throttle updated
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmountUpd.sub(redeemAmount))

          // Issuance throttle recharged, impacted mostly by redemption - 10K + period recharge
          expect(await rToken.issuanceAvailable()).to.equal(redeemAmount.add(rechargePerBlock))

          // Check issuance and redemption processed successfully
          expect(await rToken.balanceOf(addr1.address)).to.equal(
            issueAmount.add(config.issuanceThrottle.amtRate).sub(redeemAmount)
          )
        })
      })
    })

    context('Custom redemption', function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')
        // Provide approvals
        await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)
      })

      it('Should revert if zero amount #fast', async function () {
        const zero: BigNumber = bn('0')
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(addr1.address, zero, [await basketHandler.nonce()], [fp('1')], [], [])
        ).to.be.revertedWith('Cannot redeem zero')
      })

      it('Should revert if no balance of RToken #fast', async function () {
        const redeemAmount: BigNumber = bn('20000e18')
        const nonce = await basketHandler.nonce()
        await expect(
          rToken
            .connect(addr2)
            .redeemCustom(addr2.address, redeemAmount, [nonce], [fp('1')], [], [])
        ).to.be.revertedWith('insufficient balance')
      })

      it('Should revert if portions do not sum to FIX_ONE #fast', async function () {
        const nonce = await basketHandler.nonce()
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(
              addr1.address,
              fp('1'),
              [nonce, nonce],
              [fp('0.5'), fp('0.5').add(1)],
              [],
              []
            )
        ).to.be.revertedWith('portions do not add up to FIX_ONE')
      })

      it('Should redeemCustom RTokens correctly', async function () {
        const redeemAmount = bn('100e18')

        // Check balances
        expect(await rToken.balanceOf(addr1.address)).to.equal(redeemAmount)
        expect(await rToken.totalSupply()).to.equal(redeemAmount)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

        // Redeem rTokens
        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(
          basketNonces,
          portions,
          redeemAmount
        )

        await rToken
          .connect(addr1)
          .redeemCustom(
            addr1.address,
            redeemAmount,
            basketNonces,
            portions,
            quote.erc20s,
            quote.quantities
          )

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        await Promise.all(
          tokens.map(async (t) => {
            expect(await t.balanceOf(addr1.address)).to.equal(initialBal)
          })
        )

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.sub(redeemAmount)
        )
      })

      it('Should redeem to a different account', async function () {
        // Provide approvals
        await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

        // Redeem rTokens to another account
        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(basketNonces, portions, issueAmount)
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(
              addr2.address,
              issueAmount,
              basketNonces,
              portions,
              quote.erc20s,
              quote.quantities
            )
        )
          .to.emit(rToken, 'Redemption')
          .withArgs(addr1.address, addr2.address, issueAmount, issueAmount)
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(addr2.address)).to.equal(0)
        expect(await token0.balanceOf(addr2.address)).to.equal(initialBal.add(issueAmount.div(4)))
      })

      it('Should redeem RTokens correctly for multiple users', async function () {
        const issueAmount = bn('100e18')
        const redeemAmount = bn('100e18')

        // Issue new RTokens
        await Promise.all(tokens.map((t) => t.connect(addr2).approve(rToken.address, initialBal)))

        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

        // Issue rTokens
        await rToken.connect(addr2).issue(issueAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )

        // Redeem rTokens
        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(
          basketNonces,
          portions,
          redeemAmount
        )
        await rToken
          .connect(addr1)
          .redeemCustom(
            addr1.address,
            redeemAmount,
            basketNonces,
            portions,
            quote.erc20s,
            quote.quantities
          )

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2).sub(redeemAmount)
        )

        // Redeem rTokens with another user
        await rToken
          .connect(addr2)
          .redeemCustom(
            addr2.address,
            redeemAmount,
            basketNonces,
            portions,
            quote.erc20s,
            quote.quantities
          )

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(addr2.address)).to.equal(0)

        expect(await rToken.totalSupply()).to.equal(0)

        await Promise.all(
          tokens.map(async (t) => {
            expect(await t.balanceOf(addr1.address)).to.equal(initialBal)
            expect(await t.balanceOf(addr2.address)).to.equal(initialBal)
          })
        )

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2).sub(redeemAmount.mul(2))
        )
      })

      it('Should redeem if basket is IFFY #fast', async function () {
        // Default one of the tokens - 50% price reduction and mark default as probable
        await setOraclePrice(collateral3.address, bn('0.5e8'))

        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(basketNonces, portions, issueAmount)
        await rToken
          .connect(addr1)
          .redeemCustom(
            addr1.address,
            issueAmount,
            basketNonces,
            portions,
            quote.erc20s,
            quote.quantities
          )
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should redeem if basket is UNPRICED #fast', async function () {
        await advanceTime(DECAY_DELAY.toString())

        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(basketNonces, portions, issueAmount)
        await rToken
          .connect(addr1)
          .redeemCustom(
            addr1.address,
            issueAmount,
            basketNonces,
            portions,
            quote.erc20s,
            quote.quantities
          )
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should redeem if paused #fast', async function () {
        await main.connect(owner).pauseTrading()
        await main.connect(owner).pauseIssuance()
        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(basketNonces, portions, issueAmount)
        await rToken
          .connect(addr1)
          .redeemCustom(
            addr1.address,
            issueAmount,
            basketNonces,
            portions,
            quote.erc20s,
            quote.quantities
          )
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should revert if frozen #fast', async function () {
        await main.connect(owner).freezeShort()

        // Try to redeem
        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(basketNonces, portions, issueAmount)
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(
              addr1.address,
              issueAmount,
              basketNonces,
              portions,
              quote.erc20s,
              quote.quantities
            )
        ).to.be.revertedWith('frozen')

        // Check values
        expect(await rToken.totalSupply()).to.equal(issueAmount)
      })

      it('Should revert if empty redemption #fast', async function () {
        // Eliminate most token balances
        const bal = issueAmount.div(4)
        await token0.connect(owner).burn(backingManager.address, bal)
        await token1.connect(owner).burn(backingManager.address, toBNDecimals(bal, 6))
        await token2.connect(owner).burn(backingManager.address, bal)

        // Should not revert with empty redemption yet
        const basketNonces = [1]
        const portions = [fp('1')]
        await expect(
          basketHandler.quoteCustomRedemption(basketNonces, portions, issueAmount.div(2))
        ).to.not.be.reverted
        await rToken
          .connect(addr1)
          .redeemCustom(addr1.address, issueAmount.div(2), basketNonces, portions, [], [])
        expect(await rToken.totalSupply()).to.equal(issueAmount.div(2))

        // Burn the rest
        await token3
          .connect(owner)
          .burn(backingManager.address, await token3.balanceOf(backingManager.address))

        // Now it should revert
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(addr1.address, issueAmount.div(2), basketNonces, portions, [], [])
        ).to.be.revertedWith('empty redemption')

        // Check values
        expect(await rToken.totalSupply()).to.equal(issueAmount.div(2))
      })

      it('Should prorate redemption if basket is DISABLED from fallen refPerTok() #fast', async function () {
        // Default immediately
        await token2.setExchangeRate(fp('0.1')) // 90% decrease

        // Even though a single BU requires 10x token2 as before, it should still hand out evenly

        // 1st redemption
        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(
          basketNonces,
          portions,
          issueAmount.div(2)
        )
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(
              addr1.address,
              issueAmount.div(2),
              basketNonces,
              portions,
              quote.erc20s,
              quote.quantities
            )
        ).to.emit(rToken, 'Redemption')
        expect(await rToken.totalSupply()).to.equal(issueAmount.div(2))
        expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount.div(8)))
        expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount.div(8)))

        // 2nd redemption
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(
              addr1.address,
              issueAmount.div(2),
              basketNonces,
              portions,
              quote.erc20s,
              quote.quantities
            )
        ).to.emit(rToken, 'Redemption')
        expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
      })

      it('Should not revert when redeeming mostly unregistered collateral #fast', async function () {
        // Unregister everything except token0
        const erc20s = await assetRegistry.erc20s()
        for (const erc20 of erc20s) {
          if (erc20 != token0.address) {
            await assetRegistry.connect(owner).unregister(await assetRegistry.toAsset(erc20))
          }
        }

        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(
          basketNonces,
          portions,
          issueAmount.div(2)
        )
        await rToken
          .connect(addr1)
          .redeemCustom(
            addr1.address,
            issueAmount.div(2),
            basketNonces,
            portions,
            quote.erc20s,
            quote.quantities
          )

        // Adding an unregistered ERC20 to the erc20sOut should not break anything
        expect(await assetRegistry.isRegistered(token2.address)).to.equal(false)
        const neweRC20s = JSON.parse(JSON.stringify(quote.erc20s))
        const newQuantities = JSON.parse(JSON.stringify(quote.quantities))
        neweRC20s.push(token2.address)
        newQuantities.push(fp('0'))
        await rToken
          .connect(addr1)
          .redeemCustom(
            addr1.address,
            issueAmount.div(2),
            basketNonces,
            portions,
            neweRC20s,
            newQuantities
          )
      })

      it('Should redeem prorata when refPerTok() is 0 #fast', async function () {
        // Set refPerTok to 0
        await token2.setExchangeRate(fp('0'))

        // Redemption
        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(basketNonces, portions, issueAmount)
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(
              addr1.address,
              issueAmount,
              basketNonces,
              portions,
              quote.erc20s,
              quote.quantities
            )
        ).to.emit(rToken, 'Redemption')
        expect(await rToken.totalSupply()).to.equal(0)
        expect(await token0.balanceOf(addr1.address)).to.be.equal(initialBal)
        expect(await token1.balanceOf(addr1.address)).to.be.equal(initialBal)
        expect(await token2.balanceOf(addr1.address)).to.be.equal(initialBal)
        expect(await token3.balanceOf(addr1.address)).to.be.equal(initialBal)
      })

      it('Should not overflow BU exchange rate above 1e9 on redeem', async function () {
        // Leave only 1 RToken issue
        const basketNonces = [1]
        const portions = [fp('1')]
        const quote = await basketHandler.quoteCustomRedemption(
          basketNonces,
          portions,
          issueAmount.sub(bn('1e18'))
        )
        await rToken
          .connect(addr1)
          .redeemCustom(
            addr1.address,
            issueAmount.sub(bn('1e18')),
            basketNonces,
            portions,
            quote.erc20s,
            quote.quantities
          )

        expect(await rToken.totalSupply()).to.equal(fp('1'))

        // setBasketsNeeded()
        await whileImpersonating(backingManager.address, async (signer) => {
          await rToken.connect(signer).setBasketsNeeded(fp('1e9'))
        })

        const redeemAmount: BigNumber = bn('1.5e9')

        // Redeem rTokens successfully
        const quote2 = await basketHandler.quoteCustomRedemption(
          basketNonces,
          portions,
          bn(redeemAmount)
        )
        await expect(
          rToken
            .connect(addr1)
            .redeemCustom(
              addr1.address,
              bn(redeemAmount),
              basketNonces,
              portions,
              quote2.erc20s,
              quote2.quantities
            )
        ).to.not.be.reverted
      })

      context('And redemption throttling', function () {
        // the fixture-configured redemption throttle uses 5%
        let redemptionThrottleParams: ThrottleParams
        let redeemAmount: BigNumber

        beforeEach(async function () {
          redemptionThrottleParams = {
            amtRate: fp('2'), // 2 RToken,
            pctRate: fp('0.1'), // 10%
          }
          await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
          const params = await rToken.redemptionThrottleParams()
          expect(params[0]).to.equal(redemptionThrottleParams.amtRate)
          expect(params[1]).to.equal(redemptionThrottleParams.pctRate)

          // Charge throttle
          await advanceTime(3600)
        })

        it('Should be able to do geometric redemptions to scale down supply', async function () {
          // Should complete is just under 30 iterations at rates: 10% + 1e18
          const numIterations = 30
          for (let i = 0; i < numIterations; i++) {
            const totalSupply = await rToken.totalSupply()
            if (totalSupply.eq(0)) break

            // Charge + redeem
            await advanceTime(3600)
            redeemAmount = await rToken.redemptionAvailable()

            const basketNonces = [1]
            const portions = [fp('1')]
            const quote = await basketHandler.quoteCustomRedemption(
              basketNonces,
              portions,
              redeemAmount
            )
            await rToken
              .connect(addr1)
              .redeemCustom(
                addr1.address,
                redeemAmount,
                basketNonces,
                portions,
                quote.erc20s,
                quote.quantities
              )
            issueAmount = issueAmount.sub(redeemAmount)
            expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
            expect(await rToken.totalSupply()).to.equal(issueAmount)

            // Should reach dust supply before exhausting loop iterations
            expect(i < numIterations - 1).to.equal(true)
          }

          expect(await rToken.totalSupply()).to.equal(0)
        })

        it('Should revert on overly-large redemption #fast', async function () {
          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)

          // Check issuance throttle - full
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          const basketNonces = [1]
          const portions = [fp('1')]
          const quote = await basketHandler.quoteCustomRedemption(
            basketNonces,
            portions,
            redeemAmount.add(1)
          )
          await expect(
            rToken
              .connect(addr1)
              .redeemCustom(
                addr1.address,
                redeemAmount.add(1),
                basketNonces,
                portions,
                quote.erc20s,
                quote.quantities
              )
          ).to.be.revertedWith('supply change throttled')
          const quote2 = await basketHandler.quoteCustomRedemption(
            basketNonces,
            portions,
            redeemAmount
          )
          await rToken
            .connect(addr1)
            .redeemCustom(
              addr1.address,
              redeemAmount,
              basketNonces,
              portions,
              quote2.erc20s,
              quote2.quantities
            )

          // Check updated redemption throttle
          expect(await rToken.redemptionAvailable()).to.equal(bn(0))

          // Check issuance throttle - remains
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
        })

        it('Should support 1e48 amtRate throttles', async function () {
          const throttles = JSON.parse(JSON.stringify(config.redemptionThrottle))
          throttles.amtRate = bn('1e48')
          await rToken.connect(owner).setIssuanceThrottleParams(throttles)
          await rToken.connect(owner).setRedemptionThrottleParams(throttles)

          // Mint collateral
          await token0.mint(addr1.address, throttles.amtRate)
          await token1.mint(addr1.address, throttles.amtRate)
          await token2.mint(addr1.address, throttles.amtRate)
          await token3.mint(addr1.address, throttles.amtRate)

          // Provide approvals
          await Promise.all(
            tokens.map((t) => t.connect(addr1).approve(rToken.address, MAX_UINT256))
          )

          // Charge throttle
          await advanceTime(3600)
          expect(await rToken.issuanceAvailable()).to.equal(throttles.amtRate)

          // Issue
          await rToken.connect(addr1).issue(throttles.amtRate)
          expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(throttles.amtRate))

          // Redeem
          expect(await rToken.redemptionAvailable()).to.equal(throttles.amtRate)
          const basketNonces = [1]
          const portions = [fp('1')]
          const quote = await basketHandler.quoteCustomRedemption(
            basketNonces,
            portions,
            throttles.amtRate
          )
          await rToken
            .connect(addr1)
            .redeemCustom(
              addr1.address,
              throttles.amtRate,
              basketNonces,
              portions,
              quote.erc20s,
              quote.quantities
            )
          expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
        })

        it('Should use amtRate if pctRate is zero', async function () {
          redeemAmount = redemptionThrottleParams.amtRate
          redemptionThrottleParams.pctRate = bn(0)
          await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)

          // Large redemption should fail
          const basketNonces = [1]
          const portions = [fp('1')]
          const quote = await basketHandler.quoteCustomRedemption(
            basketNonces,
            portions,
            redeemAmount.add(1)
          )
          await expect(
            rToken
              .connect(addr1)
              .redeemCustom(
                addr1.address,
                redeemAmount.add(1),
                basketNonces,
                portions,
                quote.erc20s,
                quote.quantities
              )
          ).to.be.revertedWith('supply change throttled')

          // amtRate redemption should succeed
          await expect(
            rToken
              .connect(addr1)
              .redeemCustom(
                addr1.address,
                redeemAmount,
                basketNonces,
                portions,
                quote.erc20s,
                quote.quantities
              )
          ).to.emit(rToken, 'Redemption')

          // Check redemption throttle is 0
          expect(await rToken.redemptionAvailable()).to.equal(bn(0))
        })

        it('Should throttle after allowing two redemptions of half value #fast', async function () {
          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          // Check redemption throttle
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)

          // Issuance throttle is fully charged
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #1
          await rToken.connect(addr1).redeem(redeemAmount.div(2))

          // Check redemption throttle updated
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount.div(2))

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #2
          await rToken.connect(addr1).redeem(redeemAmount.div(2))

          // Check redemption throttle updated - very small
          expect(await rToken.redemptionAvailable()).to.be.closeTo(fp('0.002638'), fp('0.000001'))

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #3 - should not be processed
          await expect(rToken.connect(addr1).redeem(redeemAmount.div(100))).to.be.revertedWith(
            'supply change throttled'
          )

          // Advance time significantly
          await advanceTime(10000000000)

          // Check redemption throttle recharged
          const balance = issueAmount.sub(redeemAmount)
          const redeemAmountUpd = balance.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmountUpd)

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
        })

        it('Should handle redemption throttle correctly, using only amount', async function () {
          // Check initial balance
          expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

          // set fixed amount
          redemptionThrottleParams.amtRate = fp('25')
          redemptionThrottleParams.pctRate = bn(0)
          await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)

          // advance time
          await advanceTime(12 * 5 * 60) // 60 minutes, charge fully

          // Check redemption throttle
          expect(await rToken.redemptionAvailable()).to.equal(redemptionThrottleParams.amtRate)

          // Issuance throttle is fully charged
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #1 -  Will be processed
          redeemAmount = fp('12.5')
          await rToken.connect(addr1).redeem(redeemAmount)

          // Check redemption throttle updated
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Attempt to redeem max amt, should not be processed
          await expect(
            rToken.connect(addr1).redeem(redemptionThrottleParams.amtRate)
          ).to.be.revertedWith('supply change throttled')

          // Advance one hour. Redemption should be fully rechardged
          await advanceTime(3600)

          // Check redemption throttle updated
          expect(await rToken.redemptionAvailable()).to.equal(redemptionThrottleParams.amtRate)

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Redeem #2 - will be processed
          await rToken.connect(addr1).redeem(redemptionThrottleParams.amtRate)

          // Check redemption throttle emptied
          expect(await rToken.redemptionAvailable()).to.equal(bn(0))

          // Issuance throttle remains equal
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Check redemptions processed successfully
          expect(await rToken.balanceOf(addr1.address)).to.equal(
            issueAmount.sub(redeemAmount).sub(redemptionThrottleParams.amtRate)
          )
        })

        it('Should update issuance throttle correctly on redemption', async function () {
          const rechargePerBlock = config.issuanceThrottle.amtRate.div(BLOCKS_PER_HOUR)

          redeemAmount = issueAmount.mul(redemptionThrottleParams.pctRate).div(fp('1'))
          // Check redemption throttle
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmount)

          // Issuance throttle is fully charged
          expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)

          // Issue all available
          await rToken.connect(addr1).issue(config.issuanceThrottle.amtRate)

          // Issuance throttle empty
          expect(await rToken.issuanceAvailable()).to.equal(bn(0))

          // Redemption allowed increase
          const redeemAmountUpd = issueAmount
            .add(config.issuanceThrottle.amtRate)
            .mul(redemptionThrottleParams.pctRate)
            .div(fp('1'))
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmountUpd)

          // Redeem #1 -  Will be processed
          redeemAmount = fp('10000')
          await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
          await rToken.connect(addr1).redeem(redeemAmount)

          // Check redemption throttle updated
          expect(await rToken.redemptionAvailable()).to.equal(redeemAmountUpd.sub(redeemAmount))

          // Issuance throttle recharged, impacted mostly by redemption - 10K + period recharge
          expect(await rToken.issuanceAvailable()).to.equal(redeemAmount.add(rechargePerBlock))

          // Check issuance and redemption processed successfully
          expect(await rToken.balanceOf(addr1.address)).to.equal(
            issueAmount.add(config.issuanceThrottle.amtRate).sub(redeemAmount)
          )
        })
      })
    })
  })

  describe('Melt/Mint #fast', () => {
    const issueAmount: BigNumber = bn('100e18')

    beforeEach(async () => {
      // Issue some RTokens
      await mintCollaterals(owner, [addr1], issueAmount, basket)

      // Approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Issue tokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    it('Should not melt if caller is not furnace', async () => {
      await expect(rToken.connect(addr1).melt(issueAmount)).to.be.revertedWith('furnace only')
    })

    it('Should not allow transfer/transferFrom to address(this)', async () => {
      // transfer
      await expect(rToken.connect(addr1).transfer(rToken.address, 1)).to.be.revertedWith(
        'RToken transfer to self'
      )

      // transferFrom
      await rToken.connect(addr1).approve(addr2.address, 1)
      await expect(
        rToken.connect(addr2).transferFrom(addr1.address, rToken.address, 1)
      ).to.be.revertedWith('RToken transfer to self')
    })

    it('Should only allow to mint tokens when called by backing manager', async () => {
      // Mint tokens
      const mintAmount: BigNumber = bn('10e18')

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      await whileImpersonating(backingManager.address, async (signer) => {
        await rToken.connect(signer).mint(mintAmount)
      })

      expect(await rToken.balanceOf(backingManager.address)).to.equal(mintAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount.add(mintAmount))

      // Trying to mint with another account will fail
      await expect(rToken.connect(other).mint(mintAmount)).to.be.revertedWith('not backing manager')

      // Trying to mint from a non-backing manager component should fail
      await whileImpersonating(basketHandler.address, async (signer) => {
        await expect(rToken.connect(signer).mint(mintAmount)).to.be.revertedWith(
          'not backing manager'
        )
      })
    })

    it('Should not allow setBasketsNeeded to set BU exchange rate to outside [1e-9, 1e9]', async () => {
      // setBasketsNeeded()
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(
          rToken.connect(signer).setBasketsNeeded(issueAmount.mul(bn('1e9')).add(1))
        ).to.be.revertedWith('BU rate out of range')
        await expect(
          rToken.connect(signer).setBasketsNeeded(issueAmount.div(bn('1e9')).sub(1))
        ).to.be.revertedWith('BU rate out of range')
        await rToken.connect(signer).setBasketsNeeded(issueAmount.mul(bn('1e9')))
        await rToken.connect(signer).setBasketsNeeded(issueAmount.div(bn('1e9')))
      })
    })

    it('Should not allow setBasketsNeeded if paused', async () => {
      // Check initial status
      expect(await rToken.basketsNeeded()).to.equal(issueAmount)

      // Pause Main
      await main.connect(owner).pauseTrading()

      // Try to set baskets needed
      await whileImpersonating(backingManager.address, async (bhSigner) => {
        await expect(rToken.connect(bhSigner).setBasketsNeeded(fp('1'))).to.be.revertedWith(
          'frozen or trading paused'
        )
      })

      // Check value remains the same
      expect(await rToken.basketsNeeded()).to.equal(issueAmount)
    })

    it('Should not allow setBasketsNeeded if frozen', async () => {
      // Check initial status
      expect(await rToken.basketsNeeded()).to.equal(issueAmount)

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Try to set baskets needed
      await whileImpersonating(backingManager.address, async (bhSigner) => {
        await expect(rToken.connect(bhSigner).setBasketsNeeded(fp('1'))).to.be.revertedWith(
          'frozen or trading paused'
        )
      })

      // Check value remains the same
      expect(await rToken.basketsNeeded()).to.equal(issueAmount)
    })

    it('mint() should not change the BU exchange rate', async () => {
      // mint()
      await whileImpersonating(backingManager.address, async (signer) => {
        await rToken.connect(signer).mint(issueAmount.mul(bn('1e9')).add(1).sub(issueAmount))
        const basketsNeeded = await rToken.basketsNeeded()
        const supply = await rToken.totalSupply()
        expect(basketsNeeded.mul(fp('1')).div(supply)).to.equal(fp('1'))
      })
    })
  })

  describe('Transfers #fast', () => {
    let amount: BigNumber

    beforeEach(async function () {
      amount = bn('10e18')

      // Provide approvals
      await Promise.all(tokens.map((t) => t.connect(addr1).approve(rToken.address, initialBal)))

      // Issue rTokens
      await rToken.connect(addr1).issue(amount)
    })

    it('Should transfer tokens between accounts', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      //  Perform transfer
      await rToken.connect(addr1).transfer(addr2.address, amount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev.sub(amount))
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev.add(amount))
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should not transfer if no balance', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      //  Perform transfer with user with no balance
      await expect(rToken.connect(addr2).transfer(addr1.address, amount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )

      // Nothing transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should not transfer from/to zero address', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      // Attempt to send to zero address
      await expect(rToken.connect(addr1).transfer(ZERO_ADDRESS, amount)).to.be.revertedWith(
        'ERC20: transfer to the zero address'
      )

      // Attempt to send from zero address - Impersonation is the only way to get to this validation
      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(rToken.connect(signer).transfer(addr2.address, amount)).to.be.revertedWith(
          'ERC20: transfer from the zero address'
        )
      })

      // Nothing transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should not allow transfer/transferFrom to address(this)', async () => {
      // transfer
      await expect(rToken.connect(addr1).transfer(rToken.address, 1)).to.be.revertedWith(
        'RToken transfer to self'
      )

      // transferFrom
      await rToken.connect(addr1).approve(addr2.address, 1)
      await expect(
        rToken.connect(addr2).transferFrom(addr1.address, rToken.address, 1)
      ).to.be.revertedWith('RToken transfer to self')
    })

    it('Should transferFrom between accounts', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      // Set allowance and transfer
      await rToken.connect(addr1).approve(addr2.address, amount)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)

      await rToken.connect(addr2).transferFrom(addr1.address, other.address, amount)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev.sub(amount))
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await rToken.balanceOf(other.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should set allowance when using "Permit"', async () => {
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)

      const permit = await signERC2612Permit(
        addr1,
        {
          name: await rToken.name(),
          version: VERSION,
          chainId: await getChainId(hre),
          verifyingContract: rToken.address,
        },
        addr1.address,
        addr2.address,
        amount.toString()
      )

      await expect(
        rToken.permit(
          addr1.address,
          addr2.address,
          amount,
          permit.deadline,
          permit.v,
          permit.r,
          permit.s
        )
      )
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)
    })

    it('Should perform validations on "Permit"', async () => {
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)

      // Set invalid signature
      const permit = await signERC2612Permit(
        addr1,
        rToken.address,
        addr1.address,
        addr2.address,
        amount.add(1).toString()
      )

      // Attempt to run permit with invalid signature
      await expect(
        rToken.permit(
          addr1.address,
          addr2.address,
          amount,
          permit.deadline,
          permit.v,
          permit.r,
          permit.s
        )
      ).to.be.revertedWith('ERC20Permit: invalid signature')

      // Attempt to run permit with expired deadline
      await expect(
        rToken.permit(
          addr1.address,
          addr2.address,
          amount,
          (await getLatestBlockTimestamp()) - 1,
          permit.v,
          permit.r,
          permit.s
        )
      ).to.be.revertedWith('ERC20Permit: expired deadline')

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)
    })

    it('Should not transferFrom if no allowance', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      // Transfer
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)
      await expect(
        rToken.connect(addr2).transferFrom(addr1.address, other.address, amount)
      ).to.be.revertedWith('ERC20: insufficient allowance')

      // Nothing transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await rToken.balanceOf(other.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should perform validations on approvals', async function () {
      expect(await rToken.allowance(addr1.address, ZERO_ADDRESS)).to.equal(0)
      expect(await rToken.allowance(ZERO_ADDRESS, addr2.address)).to.equal(0)

      // Attempt to set allowance to zero address
      await expect(rToken.connect(addr1).approve(ZERO_ADDRESS, amount)).to.be.revertedWith(
        'ERC20: approve to the zero address'
      )

      // Attempt set allowance from zero address - Impersonation is the only way to get to this validation
      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(rToken.connect(signer).approve(addr2.address, amount)).to.be.revertedWith(
          'ERC20: approve from the zero address'
        )
      })

      // Nothing set
      expect(await rToken.allowance(addr1.address, ZERO_ADDRESS)).to.equal(0)
      expect(await rToken.allowance(ZERO_ADDRESS, addr2.address)).to.equal(0)
    })

    it('Should allow to increase/decrease allowances', async function () {
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)

      //  Increase allowance
      await expect(rToken.connect(addr1).increaseAllowance(addr2.address, amount))
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)

      // Increase again
      await expect(rToken.connect(addr1).increaseAllowance(addr2.address, amount))
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, amount.mul(2))

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount.mul(2))

      // Decrease allowance
      await expect(rToken.connect(addr1).decreaseAllowance(addr2.address, amount))
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)

      // Should not allow to decrease below zero
      await expect(
        rToken.connect(addr1).decreaseAllowance(addr2.address, amount.add(1))
      ).to.be.revertedWith('ERC20: decreased allowance below zero')

      // No changes
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)
    })

    it('Should not decrease allowance when Max allowance pattern is used', async function () {
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)

      // Increase to maximum allowance
      await expect(rToken.connect(addr1).increaseAllowance(addr2.address, MAX_UINT256))
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, MAX_UINT256)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(MAX_UINT256)

      // Perform a transfer, should not decrease allowance (Max allowance pattern assumed)
      await rToken.connect(addr2).transferFrom(addr1.address, other.address, amount)

      // Remains the same
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(MAX_UINT256)
    })
  })

  describe('monetizeDonations #fast', () => {
    const donationAmt = fp('100')
    beforeEach(async () => {
      await token3.connect(owner).mint(rToken.address, donationAmt)
      expect(await token3.balanceOf(rToken.address)).to.equal(donationAmt)
    })

    it('should require erc20 is registered', async () => {
      await assetRegistry.connect(owner).unregister(collateral3.address)
      await expect(rToken.monetizeDonations(token3.address)).to.be.revertedWith(
        'erc20 unregistered'
      )
    })

    it('should not monetize while paused', async () => {
      await main.connect(owner).pauseTrading()
      await expect(rToken.monetizeDonations(token3.address)).to.be.revertedWith(
        'frozen or trading paused'
      )
    })

    it('should not monetize while frozen', async () => {
      await main.connect(owner).freezeShort()
      await expect(rToken.monetizeDonations(token3.address)).to.be.revertedWith(
        'frozen or trading paused'
      )
    })

    it('should monetize registered erc20s', async () => {
      const backingManagerBalBefore = await token3.balanceOf(backingManager.address)
      await expect(rToken.monetizeDonations(token3.address)).to.emit(token3, 'Transfer')
      expect(await token3.balanceOf(rToken.address)).to.equal(0)
      const backingManagerBalAfter = await token3.balanceOf(backingManager.address)
      expect(backingManagerBalAfter.sub(backingManagerBalBefore)).to.equal(donationAmt)
    })
  })

  describe('ERC1271 permit #fast', () => {
    const issueAmount = bn('100e18') // fits into one block
    let erc1271Mock: ERC1271Mock

    beforeEach(async () => {
      const ERC1271Factory = await ethers.getContractFactory('ERC1271Mock')
      erc1271Mock = await ERC1271Factory.deploy()

      // Issue
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Give RToken balance at ERC1271Mock
      await rToken.connect(addr1).transfer(erc1271Mock.address, issueAmount)
    })

    it('should not permit without ERC1271 support', async () => {
      // Try a smart contract that does not support ERC1271
      await expect(
        rToken.permit(
          main.address,
          addr1.address,
          issueAmount,
          bn(2).pow(255),
          0,
          ethers.utils.formatBytes32String(''),
          ethers.utils.formatBytes32String('')
        )
      ).to.be.reverted
      expect(await rToken.allowance(main.address, addr1.address)).to.equal(0)

      // Try the ERC1271Mock with approvals turned off
      await expect(
        rToken.permit(
          erc1271Mock.address,
          addr1.address,
          issueAmount,
          bn(2).pow(255),
          0,
          ethers.utils.formatBytes32String(''),
          ethers.utils.formatBytes32String('')
        )
      ).to.be.revertedWith('ERC1271: Unauthorized')
      expect(await rToken.allowance(erc1271Mock.address, addr1.address)).to.equal(0)
    })

    it('should permit spend with ERC1271 support', async () => {
      // ERC1271 with approvals turned on
      expect(await rToken.nonces(erc1271Mock.address)).to.equal(0)
      await erc1271Mock.enableApprovals()
      await rToken.permit(
        erc1271Mock.address,
        addr1.address,
        issueAmount,
        bn(2).pow(255),
        0,
        ethers.utils.formatBytes32String(''),
        ethers.utils.formatBytes32String('')
      )
      expect(await rToken.allowance(erc1271Mock.address, addr1.address)).to.equal(issueAmount)
      await rToken.connect(addr1).transferFrom(erc1271Mock.address, addr1.address, issueAmount)
      expect(await rToken.balanceOf(erc1271Mock.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.nonces(erc1271Mock.address)).to.equal(1)
    })
  })

  describeGas('Gas Reporting', () => {
    let issueAmount: BigNumber

    beforeEach(async () => {
      issueAmount = config.issuanceThrottle.amtRate

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)
    })

    it('Transfer', async () => {
      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Transfer
      await snapshotGasCost(rToken.connect(addr1).transfer(addr2.address, issueAmount.div(2)))

      // Transfer again
      await snapshotGasCost(rToken.connect(addr1).transfer(addr2.address, issueAmount.div(2)))

      // Transfer back
      await snapshotGasCost(rToken.connect(addr2).transfer(addr1.address, issueAmount))
    })

    it('Issuance: within block', async () => {
      // Issue rTokens twice within block
      await snapshotGasCost(rToken.connect(addr1).issue(issueAmount.div(2)))
      await snapshotGasCost(rToken.connect(addr1).issue(issueAmount.div(2)))
    })

    it('Redemption', async () => {
      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount.div(2))
      await snapshotGasCost(rToken.connect(addr1).redeem(issueAmount.div(2)))
    })
  })
})
