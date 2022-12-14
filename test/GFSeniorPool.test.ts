import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from './fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from '../test/integration/individual-collateral/fixtures'
import { getChainId } from '../common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../common/events'
import { bn, fp, toBNDecimals } from '../common/numbers'
import { whileImpersonating } from './utils/impersonation'
import { setOraclePrice } from './utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from './utils/time'
import {
  Asset,
  GFSeniorPoolCollateral,
  IGFSeniorPool,
  GoldfinchSeniorPoolMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  InvalidMockV3Aggregator,
  OracleLib,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  IGoldfinchLegacyConfig,
} from '../typechain'

const createFixtureLoader = waffle.createFixtureLoader

// Holder addresses in Mainnet
const gspHolder = '0xb45b74eb35790d20e5f4225b0ac49d5bb074696e'
const usdcHolder = '0xcffad3200574698b78f32232aa9d63eabd290703'

const legacyGoldfinchList = '0x4eb844Ff521B4A964011ac8ecd42d500725C95CC'

const goldfinchAdmin = '0xa083880f7a5df37bf00a25380c3eb9af9cd92d8f'
const goldfinchTranchedPool = '0xc9bdd0d3b80cc6efe79a82d850f44ec9b55387ae'
const goldfinchPoolAdmin = '0xd3207620a6c8c2dd2799b34833d6fa04444a40c7'
const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`GFSeniorPoolCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let usdc: ERC20Mock
  let fidu: ERC20Mock
  let fiduCollateral: GFSeniorPoolCollateral
  let goldfinch: IGFSeniorPool
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

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let GoldfinchSeniorPoolCollateralFactory: ContractFactory

  before(async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
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

    // Get required contracts for Goldfinch SP

    // Goldfinch Senior Pool
    goldfinch = await ethers.getContractAt(
      'IGFSeniorPool',
      networkConfig[chainId].GOLDFINCH_SENIOR_POOL || ''
    )
    // USDC token
    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )

    // Goldfinch Senior Pool token (AKA FIDU)
    fidu = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.FIDU || '')
    )

    // Deploy Goldfinch SP collateral plugin
    GoldfinchSeniorPoolCollateralFactory = await ethers.getContractFactory(
      'GFSeniorPoolCollateral',
      {
        libraries: { OracleLib: oracleLib.address },
      }
    )
    fiduCollateral = <GFSeniorPoolCollateral>await GoldfinchSeniorPoolCollateralFactory.deploy(
      fp('1'),
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      fidu.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      defaultThreshold,
      delayUntilDefault,
      goldfinch.address,
      200 // permit 200 bps or 2% drop before default
    )

    const goldfinchWhitelist = <IGoldfinchLegacyConfig>(
      await ethers.getContractAt('IGoldfinchLegacyConfig', legacyGoldfinchList)
    )

    await whileImpersonating(goldfinchAdmin, async (goldfinchAdminSigner: SignerWithAddress) => {
      await goldfinchWhitelist.connect(goldfinchAdminSigner).addToGoList(addr1.address)
    })

    // Setup balances for addr1 - Transfer from Mainnet holder
    // FIDU
    initialBal = bn('20000e18')
    await whileImpersonating(gspHolder, async (gspSigner: SignerWithAddress) => {
      await fidu.connect(gspSigner).transfer(addr1.address, toBNDecimals(initialBal, 18))
    })

    await whileImpersonating(usdcHolder, async (usdcSigner: SignerWithAddress) => {
      await usdc.connect(usdcSigner).transfer(goldfinchTranchedPool, toBNDecimals(initialBal, 6))
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
      primaryBasket: [fiduCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries: ZERO_ADDRESS,
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
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Collateral correctly', async () => {
      // Check Collateral plugin
      // cDAI (CTokenFiatCollateral)
      expect(await fiduCollateral.isCollateral()).to.equal(true)
      expect(await fiduCollateral.erc20()).to.equal(fidu.address)
      expect(await fidu.decimals()).to.equal(18)
      expect(await fiduCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await fiduCollateral.actualRefPerTok()).to.be.closeTo(fp('1.062'), fp('0.01'))
      expect(await fiduCollateral.refPerTok()).to.be.closeTo(fp('1.04076'), fp('0.01')) // 2% revenue hiding
      expect(await fiduCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await fiduCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await fiduCollateral.strictPrice()).to.be.closeTo(fp('1.062'), fp('0.001')) // close to $1.062

      expect(await fiduCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(fidu.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(fiduCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(fiduCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(fidu.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      console.log({ price })
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('1.0208'), fp('0.015'))

      // Check RToken price
      const issueAmount: BigNumber = bn('10000e18')
      await fidu.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1.0208'), fp('0.015'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        GoldfinchSeniorPoolCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fidu.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          delayUntilDefault,
          goldfinch.address,
          200
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ReferemceERC20Decimals
      await expect(
        GoldfinchSeniorPoolCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fidu.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
          ZERO_ADDRESS,
          200
        )
      ).to.be.revertedWith('!goldfinch')

      // Over 100% revenue hiding
      await expect(
        GoldfinchSeniorPoolCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fidu.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
          goldfinch.address,
          10_000
        )
      ).to.be.reverted
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await fidu.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))
      console.log('user fidu before: ', await fidu.balanceOf(addr1.address))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      console.log('user rToken Balance: ', await rToken.balanceOf(addr1.address))

      console.log('user fidu after: ', await fidu.balanceOf(addr1.address))
      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1Gsp: BigNumber = await fidu.balanceOf(addr1.address)

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(bn('10208e18'), fp('150')) // approx $10208 in value

      // Check rates and prices
      const gspPrice1: BigNumber = await fiduCollateral.strictPrice() // ~1.062 cents
      const gspRefPerTok1: BigNumber = await fiduCollateral.refPerTok() // ~1.0408 cents

      expect(gspPrice1).to.be.closeTo(fp('1.062'), fp('0.001'))
      expect(gspRefPerTok1).to.be.closeTo(fp('1.0408'), fp('0.001'))

      console.log("goldfinch borrower's balance: ", await usdc.balanceOf(goldfinchTranchedPool))
      // Repay portion of loan so that sharePrice increases

      await whileImpersonating(usdcHolder, async (usdcSigner: SignerWithAddress) => {
        await usdc.connect(usdcSigner).transfer(goldfinchTranchedPool, toBNDecimals(initialBal, 6))
      })

      await whileImpersonating(goldfinchPoolAdmin, async (poolAdminSigner: SignerWithAddress) => {
        await goldfinch.connect(poolAdminSigner).redeem(179)
      })

      console.log(
        "goldfinch borrower's balance after: ",
        await usdc.balanceOf(goldfinchTranchedPool)
      )

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await fiduCollateral.refresh()
      expect(await fiduCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inreaseq
      const gspPrice2: BigNumber = await fiduCollateral.strictPrice()
      const gspRefPerTok2: BigNumber = await fiduCollateral.refPerTok()

      // Check rates and price increase
      expect(gspPrice2).to.be.gt(gspPrice1)
      expect(gspRefPerTok2).to.be.gt(gspRefPerTok1)

      // Still close to the original values
      expect(gspPrice2).to.be.closeTo(fp('1.062'), fp('0.001'))
      expect(gspRefPerTok2).to.be.closeTo(fp('1.0408'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await fiduCollateral.refresh()
      expect(await fiduCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const gspPrice3: BigNumber = await fiduCollateral.strictPrice() // ~0.03294
      const gspRefPerTok3: BigNumber = await fiduCollateral.refPerTok() // ~0.03294

      // Check rates and price increase
      expect(gspPrice3).to.be.gt(gspPrice2)
      expect(gspRefPerTok3).to.be.gt(gspRefPerTok2)

      // Need to adjust ranges
      expect(gspPrice3).to.be.closeTo(fp('0.032'), fp('0.001'))
      expect(gspRefPerTok3).to.be.closeTo(fp('0.032'), fp('0.001'))

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
      const newBalanceAddr1Gsp: BigNumber = await fidu.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1Gsp.sub(balanceAddr1Gsp)).to.be.closeTo(bn('303570e8'), bn('8e7')) // ~0.03294 * 303571 ~= 10K (100% of basket)

      // Check remainders in Backing Manager
      expect(await fidu.balanceOf(backingManager.address)).to.be.closeTo(bn(150663e8), bn('5e7')) // ~= 4962.8 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('4962.8'), // ~= 4962.8 usd (from above)
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      // Only checking to see that claim call does not revert
      await expectEvents(backingManager.claimRewards(), [])
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe.skip('Collateral Status', () => {
    // No test for soft default b/c we rely on same Chainlink logic as ATokens and CTokens, both already thoroughly tested

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const GolfinchMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')
      const symbol = await fidu.symbol()
      const goldfinchMock: GolfinchSeniorPoolMock = <GolfinchSeniorPoolMock>(
        await GolfinchMockFactory.deploy(symbol + ' Token', symbol)
      )
      // Set initial exchange rate to the new fidu mock
      await goldfinchMock.setSharePrice(fp('1.062'))

      // Redeploy plugin using the new fidu mock
      const newGspCollateral: GFSeniorPoolCollateral = <GFSeniorPoolCollateral>await (
        await ethers.getContractFactory('GFSeniorPoolCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await fiduCollateral.chainlinkFeed(),
        goldfinchMock.address,
        await fiduCollateral.maxTradeVolume(),
        await fiduCollateral.oracleTimeout(),
        await fiduCollateral.targetName(),
        await fiduCollateral.defaultThreshold(),
        await fiduCollateral.delayUntilDefault(),
        goldfinch.address,
        200
      )

      // Check initial state
      expect(await newGspCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newGspCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for Goldfinch Senior Pool token by 1.5%
      // still within allowable revenue hiding limit
      await goldfinchMock.setSharePrice(fp('1.04607'))

      // Force updates - no default yet
      await expect(newGspCollateral.refresh()).to.not.emit(newGspCollateral, 'DefaultStatusChanged')

      // Decrease rate for Goldfinch Senior Pool token by 2.5%
      // now expecting a default
      await goldfinchMock.setSharePrice(fp('1.02'))

      // Force updates
      await expect(newGspCollateral.refresh())
        .to.emit(newGspCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newGspCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newGspCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })
  })
})
