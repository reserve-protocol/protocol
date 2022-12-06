import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from './fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../common/configuration'
import { CollateralStatus, ZERO_ADDRESS } from '../../../common/constants'
import { expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import {
  Asset,
  FCashCollateral,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  OracleLib,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  ReservefCashWrapper,
} from '../../../typechain'
import forkBlockNumber from '../fork-block-numbers'
import { advanceBlocks, advanceTime } from '../../utils/time';

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderUSDC = '0x0a59649758aa4d66e25f08dd01271e891fe52199'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`NotionalFixedRateCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let usdc: ERC20Mock
  let rwfUsdc: ReservefCashWrapper
  let rwfUsdcCollateral: FCashCollateral
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Core Contracts
  let main: TestIMain
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let deployer: TestIDeployer
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let facadeWrite: FacadeWrite
  let oracleLib: OracleLib
  let govParams: IGovParams

  // RToken Configuration
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }
  const config: IConfig = {
    dist: dist,
    minTradeVolume: fp('1e4'), // $10k
    rTokenMaxTradeVolume: fp('1e6'), // $1M
    shortFreeze: bn('259200'), // 3 days
    longFreeze: bn('2592000'), // 30 days
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    scalingRedemptionRate: fp('0.05'), // 5%
    redemptionRateFloor: fp('1e6'), // 1M RToken
  }

  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let FixedRateCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  const setup = async (blockNumber: number) => {
    // Use Mainnet fork
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_RPC_URL,
            blockNumber: blockNumber,
          },
        },
      ],
    })
  }

  before(async () => {
    await setup(forkBlockNumber['notional-fixed-rate'])
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // deploy fUsdc wrapper
    const WrappedFCashFactory = await ethers.getContractFactory('ReservefCashWrapper')
    rwfUsdc = <ReservefCashWrapper>await WrappedFCashFactory.deploy(
      '0x1344A36A1B56144C3Bc62E7757377D288fDE0369',
      '0x5D051DeB5db151C2172dCdCCD42e6A2953E27261',
      networkConfig[chainId].tokens.USDC || '',
      3 // USDC
    )

    // USDC token
    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )

    // Deploy wfUSDC collateral plugin
    FixedRateCollateralFactory = await ethers.getContractFactory('fCashCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    rwfUsdcCollateral = <FCashCollateral>await FixedRateCollateralFactory.deploy(
      fp('1'),
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      rwfUsdc.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      30, // 0.03 %
      ethers.utils.formatBytes32String('USD'),
      delayUntilDefault,
      defaultThreshold
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    const initialBal = bn('2000e6')
    await whileImpersonating(holderUSDC, async (usdcSigner) => {
      await usdc.connect(usdcSigner).transfer(addr1.address, initialBal)
    })

    // mint rwfUsdc (lend to notional + wrap)
    await usdc.connect(addr1).approve(rwfUsdc.address, initialBal)
    await rwfUsdc.connect(addr1).deposit(initialBal)

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [],
      primaryBasket: [rwfUsdcCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiary: ZERO_ADDRESS,
      revShare: { rTokenDist: bn('0'), rsrDist: bn('0') },
    }

    // Deploy RToken via FacadeWrite
    const receipt = await (
      await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
    ).wait()

    // Get Main
    const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
    main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

    // Get core contracts
    assetRegistry = <IAssetRegistry>(
      await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
    )
    backingManager = <TestIBackingManager>(
      await ethers.getContractAt('TestIBackingManager', await main.backingManager())
    )
    basketHandler = <IBasketHandler>(
      await ethers.getContractAt('IBasketHandler', await main.basketHandler())
    )
    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())
    rTokenAsset = <RTokenAsset>(
      await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
    )

    console.log(mainAddr)
    console.log(assetRegistry.address)
    console.log(backingManager.address)
    console.log(basketHandler.address)
    console.log(rToken.address)
    console.log(rTokenAsset.address)
    console.log('---')

    // Setup owner and unpause
    await facadeWrite.connect(owner).setupGovernance(
      rToken.address,
      false, // do not deploy governance
      true, // unpaused
      govParams, // mock values, not relevant
      owner.address, // owner
      ZERO_ADDRESS, // no guardian
      ZERO_ADDRESS // no pauser
    )

    // Setup mock chainlink feed for some of the tests (so we can change the value)
    MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Collateral plugin
      expect(await rwfUsdcCollateral.isCollateral()).to.equal(true)
      expect(await rwfUsdcCollateral.erc20()).to.equal(rwfUsdc.address)
      expect(await usdc.decimals()).to.equal(6)
      expect(await rwfUsdcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await rwfUsdcCollateral.refPerTok()).to.be.equal(bn('0.997e18'))
      expect(await rwfUsdcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await rwfUsdcCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await rwfUsdcCollateral.strictPrice()).to.be.equal(bn('1e18'))

      // Check claim data
      await expect(rwfUsdcCollateral.claimRewards()).to.not.emit(
        rwfUsdcCollateral,
        'RewardsClaimed'
      )
      expect(await rwfUsdcCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(rwfUsdc.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(rwfUsdcCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(rwfUsdcCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(rwfUsdc.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('1'), fp('0.015'))

      // Check RToken price
      console.log(await basketHandler.quote(bn('100e18'), 2))
      const issueAmount: BigNumber = bn('100e18')
      await rwfUsdc.connect(addr1).approve(rToken.address, issueAmount)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    // Validate constructor arguments
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        FixedRateCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          rwfUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          30, // 0.03 %
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          fp('1.01')
        )
      ).to.be.revertedWith('invalid defaultThreshold')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = bn('100e18')

      // Provide approvals for issuances
      await rwfUsdc.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1cDai: BigNumber = await rwfUsdc.balanceOf(addr1.address)

      // Check rates and prices
      const cDaiPrice1: BigNumber = await rwfUsdcCollateral.strictPrice() // ~ 0.022015 cents
      const cDaiRefPerTok1: BigNumber = await rwfUsdcCollateral.refPerTok() // ~ 0.022015 cents

      expect(cDaiPrice1).to.be.closeTo(fp('1'), fp('0.001'))
      expect(cDaiRefPerTok1).to.be.closeTo(fp('0.997'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await rwfUsdcCollateral.refresh()
      expect(await rwfUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const cDaiPrice2: BigNumber = await rwfUsdcCollateral.strictPrice() // ~0.022016
      const cDaiRefPerTok2: BigNumber = await rwfUsdcCollateral.refPerTok() // ~0.022016

      // Check rates and price increase
      expect(cDaiPrice2).to.be.gte(cDaiPrice1)
      expect(cDaiRefPerTok2).to.be.gte(cDaiRefPerTok1)

      // Still close to the original values
      expect(cDaiPrice1).to.be.closeTo(fp('1'), fp('0.001'))
      expect(cDaiRefPerTok1).to.be.closeTo(fp('0.997'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gte(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await rwfUsdcCollateral.refresh()
      expect(await rwfUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const cDaiPrice3: BigNumber = await rwfUsdcCollateral.strictPrice() // ~0.03294
      const cDaiRefPerTok3: BigNumber = await rwfUsdcCollateral.refPerTok() // ~0.03294

      // Check rates and price increase
      expect(cDaiPrice3).to.be.gte(cDaiPrice2)
      expect(cDaiRefPerTok3).to.be.gte(cDaiRefPerTok2)

      // Need to adjust ranges
      expect(cDaiPrice3).to.be.closeTo(fp('0.032'), fp('0.001'))
      expect(cDaiRefPerTok3).to.be.closeTo(fp('0.032'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer cTokens should have been sent to the user
      const newBalanceAddr1cDai: BigNumber = await rwfUsdc.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1cDai.sub(balanceAddr1cDai)).to.be.closeTo(bn('303570e8'), bn('8e7')) // ~0.03294 * 303571 ~= 10K (100% of basket)

      // Check remainders in Backing Manager
      expect(await rwfUsdc.balanceOf(backingManager.address)).to.be.closeTo(bn(150663e8), bn('5e7')) // ~= 4962.8 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('4962.8'), // ~= 4962.8 usd (from above)
        fp('0.5')
      )
    })
  })
})
