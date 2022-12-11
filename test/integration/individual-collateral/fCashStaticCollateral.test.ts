import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from './fixtures'
import { getChainId } from '#/common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '#/common/configuration'
import { CollateralStatus, ZERO_ADDRESS } from '#/common/constants'
import { expectInIndirectReceipt } from '#/common/events'
import { bn, fp, toBNDecimals } from '#/common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import {
  Asset,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  FCashStaticCollateral,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  ReservefCashWrapper,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '#/typechain'
import forkBlockNumber from '../fork-block-numbers'
import { advanceBlocks, advanceTime } from '../../utils/time'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderWETH = '0x2f0b23f53734252bda2277357e97e1517d6b042a'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`fCashStaticCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let weth: ERC20Mock
  let rwfWeth: ReservefCashWrapper
  let rwfWethCollateral: FCashStaticCollateral
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

  async function mintRwf(amount: BigNumber) {
    // mint rwfWeth (lend to notional + wrap)
    await weth.connect(addr1).approve(rwfWeth.address, amount)
    await rwfWeth.connect(addr1).deposit(amount)
  }

  async function issueRToken(amount: BigNumber) {
    const collateralAmount: BigNumber = amount.mul(2)
    await mintRwf(toBNDecimals(collateralAmount, 18))

    // Provide approvals for issuances
    await rwfWeth.connect(addr1).approve(rToken.address, collateralAmount)

    // Issue rTokens
    await expect(rToken.connect(addr1).issue(amount)).to.emit(rToken, 'Issuance')
  }

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
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, govParams } = await loadFixture(
      defaultFixture
    ))

    // deploy fUsdc wrapper
    const WrappedFCashFactory = await ethers.getContractFactory('ReservefCashWrapper')
    rwfWeth = <ReservefCashWrapper>await WrappedFCashFactory.deploy(
      networkConfig[chainId].NOTIONAL_PROXY || '',
      networkConfig[chainId].NOTIONAL_WFCASH_FACTORY || '',
      networkConfig[chainId].tokens.WETH || '',
      1 // WETH
    )

    // USDC token
    weth = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.WETH || '')
    )

    // Deploy wfUSDC collateral plugin
    FixedRateCollateralFactory = await ethers.getContractFactory('fCashStaticCollateral')
    rwfWethCollateral = <FCashStaticCollateral>await FixedRateCollateralFactory.deploy(
      fp('1'),
      networkConfig[chainId].chainlinkFeeds.ETH as string,
      rwfWeth.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      70, // 0.7 %
      ethers.utils.formatBytes32String('ETH'),
      delayUntilDefault,
      defaultThreshold
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    const initialBal = bn('2000e18')
    await whileImpersonating(holderWETH, async (usdcSigner) => {
      await weth.connect(usdcSigner).transfer(addr1.address, initialBal)
    })

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
      primaryBasket: [rwfWethCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries: [],
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
      expect(await rwfWethCollateral.isCollateral()).to.equal(true)
      expect(await rwfWethCollateral.erc20()).to.equal(rwfWeth.address)
      expect(await weth.decimals()).to.equal(18)
      expect(await rwfWethCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ETH'))
      expect(await rwfWethCollateral.refPerTok()).to.be.equal(fp(0.993)) // initial refPerTok 1, with 0.7% revenue hiding
      expect(await rwfWethCollateral.actualRefPerTok()).to.equal(fp(1))
      expect(await rwfWethCollateral.targetPerRef()).to.equal(fp(1))
      expect(await rwfWethCollateral.pricePerTarget()).to.equal(fp(1))
      expect(await rwfWethCollateral.strictPrice()).to.be.closeTo(fp(1165.71), fp(0.01))

      // Check claim data
      await expect(rwfWethCollateral.claimRewards()).to.not.emit(
        rwfWethCollateral,
        'RewardsClaimed'
      )
      expect(await rwfWethCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(rwfWeth.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(rwfWethCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(rwfWethCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(rwfWeth.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp(1173.93), fp(0.01))

      const issueAmount: BigNumber = bn('100e18')

      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      await issueRToken(issueAmount)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Check RToken price
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp(1165.84), fp(0.01))
    })

    // Validate constructor arguments
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        FixedRateCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          rwfWeth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          70, // 0.07 %
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
      await issueRToken(issueAmount)

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1rwfCash: BigNumber = await rwfWeth.balanceOf(addr1.address)

      // Check rates and prices
      const rwfCashPrice1: BigNumber = await rwfWethCollateral.strictPrice()
      const rwfCashRefPerTok1: BigNumber = await rwfWethCollateral.refPerTok()
      const rwfCashActualRefPerTok1: BigNumber = await rwfWethCollateral.actualRefPerTok()

      expect(rwfCashPrice1).to.be.closeTo(fp(1157.68), fp(0.01))
      expect(rwfCashRefPerTok1).to.be.closeTo(fp('0.993'), fp('0.001'))
      expect(rwfCashActualRefPerTok1).to.be.closeTo(fp('0.993'), fp('0.01'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(fp(116584.56), fp(0.01))

      // Advance time and blocks slightly, actualRefPerTok() does increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await rwfWethCollateral.refresh()
      expect(await rwfWethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const rwfCashPrice2: BigNumber = await rwfWethCollateral.strictPrice()
      const rwfCashRefPerTok2: BigNumber = await rwfWethCollateral.refPerTok()
      const rwfCashActualRefPerTok2: BigNumber = await rwfWethCollateral.actualRefPerTok()

      // Still close to the original values
      expect(rwfCashPrice1).to.be.closeTo(fp(1157.68), fp(0.01))
      expect(rwfCashRefPerTok1).to.be.closeTo(fp('0.993'), fp('0.001'))

      // Check rates and price increase
      expect(rwfCashPrice2).to.be.gt(rwfCashPrice1)
      expect(rwfCashRefPerTok2).to.be.equal(rwfCashRefPerTok1) // refPerTok didn't grow enough yet
      expect(rwfCashActualRefPerTok2).to.be.gt(rwfCashActualRefPerTok1)

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gte(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(3300000)
      await advanceBlocks(3300000)

      const preReinvestRefPerTok = await rwfWethCollateral.refPerTok()
      const preReinvestActualRefPerTok = await rwfWethCollateral.actualRefPerTok()
      expect(preReinvestRefPerTok).to.be.equal(fp('0.993'))
      expect(preReinvestActualRefPerTok).to.be.equal(fp('1'))

      // Refresh triggers reinvest()
      await rwfWethCollateral.refresh()
      expect(await rwfWethCollateral.status()).to.equal(CollateralStatus.SOUND)

      const postReinvestActualRefPerTok = await rwfWethCollateral.actualRefPerTok()
      expect(postReinvestActualRefPerTok).to.be.lt(preReinvestActualRefPerTok)
      expect(postReinvestActualRefPerTok).to.be.closeTo(fp(0.999), fp(0.0003))

      // Advance blocks
      await advanceTime(5000000)
      await advanceBlocks(5000000)
      // Reinvest
      await rwfWethCollateral.refresh()
      // Advance blocks again
      await advanceTime(5000000)
      await advanceBlocks(5000000)

      // actualRefPerTok() did go up, enough so our refPerTok() finally increased more than the initial drop
      expect(await rwfWethCollateral.actualRefPerTok()).to.be.gt(postReinvestActualRefPerTok)

      // Check rates and prices
      const rwfCashPrice3: BigNumber = await rwfWethCollateral.strictPrice()
      const rwfCashRefPerTok3: BigNumber = await rwfWethCollateral.refPerTok()
      const rwfCashActualRefPerTok3: BigNumber = await rwfWethCollateral.actualRefPerTok()

      // Check rates and price increase
      expect(rwfCashPrice3).to.be.gt(rwfCashPrice2)
      expect(rwfCashRefPerTok3).to.be.gt(rwfCashRefPerTok2)
      expect(rwfCashActualRefPerTok3).to.be.gt(rwfCashActualRefPerTok2)

      // Need to adjust ranges
      expect(rwfCashPrice3).to.be.closeTo(fp('0.999'), fp('0.01'))
      expect(rwfCashRefPerTok3).to.be.closeTo(fp('0.993'), fp('0.01'))
      expect(rwfCashActualRefPerTok3).to.be.closeTo(fp('1.0084'), fp('0.0001'))

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
      const newBalanceAddr1rwfCash: BigNumber = await rwfWeth.balanceOf(addr1.address)

      // Check received tokens represent the original value
      expect(newBalanceAddr1rwfCash.sub(balanceAddr1rwfCash)).to.be.closeTo(fp(100), fp(0.3)) // ~100 rwfCash

      // Check remainders in Backing Manager
      expect(await rwfWeth.balanceOf(backingManager.address)).to.be.closeTo(fp(0.81), fp(0.01)) // ~= 0.81 rwfCash profit

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp(0.81), // ~= 0.81 usd profit
        fp(0.01)
      )
    })
  })
})
