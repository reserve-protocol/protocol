import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from '../individual-collateral/fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  GoldfinchSeniorPoolCollateral,
  IGoldfinchSeniorPool,
  GolfinchSeniorPoolMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  OracleLib,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  IGoldfinchLegacyConfig,
} from '../../../typechain'
import { GoldfinchStakingWrapper } from '@typechain/GoldfinchStakingWrapper'
import forkBlockNumber from '../fork-block-numbers'
import { useEnv } from '#/utils/env'
import { UniV3OracleAsset } from '@typechain/UniV3OracleAsset'

const createFixtureLoader = waffle.createFixtureLoader

// Setup test environment
const setup = async (blockNumber: number) => {
  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

// Holder addresses in Mainnet
const gspHolder = '0xb45b74eb35790d20e5f4225b0ac49d5bb074696e'

const legacyGoldfinchList = '0x4eb844Ff521B4A964011ac8ecd42d500725C95CC'

const goldfinchAdmin = '0xa083880f7a5df37bf00a25380c3eb9af9cd92d8f'
const goldfinchTranchedPool = '0xc9bdd0d3b80cc6efe79a82d850f44ec9b55387ae'
const goldfinchPoolAdmin = '0xd3207620a6c8c2dd2799b34833d6fa04444a40c7'

const goldfinchStaking = '0xFD6FF39DA508d281C2d255e9bBBfAb34B6be60c3'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`GoldfinchSeniorPoolCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Tokens/Assets
  let gsp: ERC20Mock
  let gfiToken: ERC20Mock
  let gspCollateral: GoldfinchSeniorPoolCollateral
  let gspWrapper: GoldfinchStakingWrapper
  let goldfinch: IGoldfinchSeniorPool
  let rsr: ERC20Mock
  let rsrAsset: Asset
  let gfiAsset: Asset

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
  let GoldfinchStakingWrapperFactory: ContractFactory

  before(async () => {
    await setup(forkBlockNumber.goldfinch)
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // Get required contracts for Goldfinch SP

    // Goldfinch Senior Pool
    goldfinch = await ethers.getContractAt(
      'IGoldfinchSeniorPool',
      networkConfig[chainId].GOLDFINCH_SENIOR_POOL || ''
    )

    // Goldfinch Senior Pool token (AKA FIDU)
    gsp = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.GSP || '')
    )

    // Goldfinch governance/rewards token
    gfiToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.GFI || '')
    )

    // Deploy Goldfinch Staking Wrapper
    GoldfinchStakingWrapperFactory = await ethers.getContractFactory('GoldfinchStakingWrapper')

    gspWrapper = <GoldfinchStakingWrapper>(
      await GoldfinchStakingWrapperFactory.deploy(
        'Goldfinch Staking Wrapper',
        'wFIDU',
        goldfinchStaking,
        networkConfig[chainId].tokens.GSP
      )
    )

    // Deploy Goldfinch SP collateral plugin
    GoldfinchSeniorPoolCollateralFactory = await ethers.getContractFactory(
      'GoldfinchSeniorPoolCollateral',
      {
        libraries: { OracleLib: oracleLib.address },
      }
    )

    gfiAsset = <UniV3OracleAsset>(
      await (
        await ethers.getContractFactory('UniV3OracleAsset')
      ).deploy(
        fp('0.68'),
        networkConfig[chainId].chainlinkFeeds.ETH || '',
        gfiToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        networkConfig[chainId].tokens.WETH || ''
      )
    )

    gspCollateral = <GoldfinchSeniorPoolCollateral>(
      await GoldfinchSeniorPoolCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.USDC as string,
        gspWrapper.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        goldfinch.address,
        200 // permit 200 bps or 2% drop before default
      )
    )

    const goldfinchWhitelist = <IGoldfinchLegacyConfig>(
      await ethers.getContractAt('IGoldfinchLegacyConfig', legacyGoldfinchList)
    )

    await whileImpersonating(goldfinchAdmin, async (goldfinchAdminSigner) => {
      await goldfinchWhitelist.connect(goldfinchAdminSigner).addToGoList(addr1.address)
      await goldfinchWhitelist.connect(goldfinchAdminSigner).addToGoList(addr2.address)
    })

    // Setup GSP balances for addr1, addr2 - Transfer from Mainnet holder
    // Addr1 has greater balance than addr2 to verify wrapper reward entitlements
    initialBal = bn('20000e18')
    await whileImpersonating(gspHolder, async (gspSigner) => {
      await gsp.connect(gspSigner).transfer(addr1.address, toBNDecimals(initialBal, 18))
      await gsp.connect(gspSigner).transfer(addr2.address, toBNDecimals(initialBal.div(2), 18))
      await gsp.connect(gspSigner).transfer(owner.address, toBNDecimals(initialBal.div(2), 18))
    })

    await gsp.connect(addr1).approve(gspWrapper.address, toBNDecimals(initialBal, 18).mul(100))
    await gsp
      .connect(addr2)
      .approve(gspWrapper.address, toBNDecimals(initialBal.div(2), 18).mul(100))

    await gspWrapper.connect(addr1).deposit(addr1.address, toBNDecimals(initialBal, 18))
    await gspWrapper.connect(addr2).deposit(addr2.address, toBNDecimals(initialBal.div(2), 18))

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [gfiAsset.address],
      primaryBasket: [gspCollateral.address],
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
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Collateral correctly', async () => {
      expect(await gfiAsset.isCollateral()).to.equal(false)
      expect(await gfiAsset.erc20()).to.equal(gfiToken.address)
      expect(await gfiAsset.erc20()).to.equal(networkConfig[chainId].tokens.GFI)
      expect(await gfiToken.decimals()).to.equal(18)
      expect(await gfiAsset.strictPrice()).to.be.closeTo(fp('0.68'), fp('0.05'))

      await expect(gfiAsset.claimRewards()).to.not.emit(gfiAsset, 'RewardsClaimed')
      expect(await gfiAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check Collateral plugin
      // gsp (GoldfinchSeniorPoolCollateral)
      expect(await gspCollateral.isCollateral()).to.equal(true)
      expect(await gspCollateral.erc20()).to.equal(gspWrapper.address)
      expect(await gspWrapper.decimals()).to.equal(18)
      expect(await gspCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await gspCollateral.actualRefPerTok()).to.be.closeTo(fp('1.103'), fp('0.01'))
      expect(await gspCollateral.refPerTok()).to.be.closeTo(fp('1.082'), fp('0.01')) // 2% revenue hiding
      expect(await gspCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await gspCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await gspCollateral.strictPrice()).to.be.closeTo(fp('1.104'), fp('0.001')) // close to $1.103

      expect(await gspCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(gfiToken.address)
      expect(ERC20s[3]).to.equal(gspWrapper.address)
      expect(ERC20s.length).to.eql(4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(gfiAsset.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(gspCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(gspWrapper.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('1.0208'), fp('0.015'))

      // Check RToken price
      const issueAmount: BigNumber = bn('10000e18')
      await gspWrapper
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))
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
          gspWrapper.address,
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
          gspWrapper.address,
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
          gspWrapper.address,
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
      await gspWrapper
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1Gsp: BigNumber = await gspWrapper.balanceOf(addr1.address)

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(bn('10208e18'), fp('150')) // approx $10208 in value

      // Check rates and prices
      const gspPrice1: BigNumber = await gspCollateral.strictPrice() // ~1.062 cents
      const gspRefPerTok1: BigNumber = await gspCollateral.refPerTok() // ~1.0408 cents

      expect(gspPrice1).to.be.closeTo(fp('1.104'), fp('0.001'))
      expect(gspRefPerTok1).to.be.closeTo(fp('1.082'), fp('0.001'))

      // Advance time and blocks so interest payment is due
      await advanceTime(3000000)
      await advanceBlocks(3000)

      await whileImpersonating(goldfinchPoolAdmin, async (assessSigner) => {
        const tranchedPool = new ethers.Contract(goldfinchTranchedPool, [
          'function assess() external',
        ])
        await tranchedPool.connect(assessSigner).assess()
      })

      await whileImpersonating(goldfinchPoolAdmin, async (poolAdminSigner) => {
        await goldfinch.connect(poolAdminSigner).redeem(179)
      })

      // Refresh cToken manually (required)
      await gspCollateral.refresh()
      expect(await gspCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inreaseq
      const gspPrice2: BigNumber = await gspCollateral.strictPrice()
      const gspRefPerTok2: BigNumber = await gspCollateral.refPerTok()

      // Check rates and price increase
      expect(gspPrice2).to.be.gt(gspPrice1)
      expect(gspRefPerTok2).to.be.gt(gspRefPerTok1)

      // Still close to the original values
      expect(gspPrice2).to.be.closeTo(fp('1.104'), fp('0.001'))
      expect(gspRefPerTok2).to.be.closeTo(fp('1.082'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer cTokens should have been sent to the user
      const newBalanceAddr1Gsp: BigNumber = await gspWrapper.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1Gsp.sub(balanceAddr1Gsp)).to.be.closeTo(bn('9238e18'), bn('100e18')) // 1.082 * 9.2k ~= $10208 (100% of basket)

      // Check remainders in Backing Manager
      expect(await gspWrapper.balanceOf(backingManager.address)).to.be.closeTo(
        bn('5.98e18'),
        bn('1e17')
      ) // ~= $7 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('7'), // ~= 7 usd (from above)
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const issueAmount: BigNumber = bn('10000e18')
      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await gfiToken.balanceOf(backingManager.address)).to.equal(0)

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [gfiToken.address, bn(0)],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await gfiToken.balanceOf(backingManager.address)).to.equal(0)

      await gspWrapper
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Now we can claim rewards - check initial balance still 0
      expect(await gfiToken.balanceOf(backingManager.address)).to.equal(0)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Check rewards both in COMP and stkAAVE
      const rewardsGFI1: BigNumber = await gfiToken.balanceOf(backingManager.address)

      expect(rewardsGFI1).to.be.gt(0)

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      const rewardGFI2: BigNumber = await gfiToken.balanceOf(backingManager.address)

      expect(rewardGFI2.sub(rewardsGFI1)).to.be.gt(0)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // No test for soft default b/c we rely on same Chainlink logic as ATokens and CTokens, both already thoroughly tested

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const GolfinchMockFactory: ContractFactory = await ethers.getContractFactory(
        'GolfinchSeniorPoolMock'
      )
      const symbol = await gspWrapper.symbol()
      const goldfinchMock: GolfinchSeniorPoolMock = <GolfinchSeniorPoolMock>(
        await GolfinchMockFactory.deploy(symbol + ' Token', symbol)
      )
      // Set initial exchange rate to the new gsp mock
      await goldfinchMock.setSharePrice(fp('1.062'))

      // Redeploy plugin using the new gsp mock
      const newGspCollateral: GoldfinchSeniorPoolCollateral = <GoldfinchSeniorPoolCollateral>await (
        await ethers.getContractFactory('GoldfinchSeniorPoolCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await gspCollateral.chainlinkFeed(),
        await gspCollateral.erc20(),
        await gspCollateral.maxTradeVolume(),
        await gspCollateral.oracleTimeout(),
        await gspCollateral.targetName(),
        await gspCollateral.defaultThreshold(),
        await gspCollateral.delayUntilDefault(),
        goldfinchMock.address,
        200
      )

      // Check initial state
      expect(await newGspCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newGspCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for Goldfinch Senior Pool token by 1.5%
      // still within allowable revenue hiding limit
      await goldfinchMock.setSharePrice(fp('1.04607'))

      // Force updates - no default yet
      await expect(newGspCollateral.refresh()).to.not.emit(
        newGspCollateral,
        'CollateralStatusChanged'
      )

      // Decrease rate for Goldfinch Senior Pool token by 4%
      // now expecting a default
      await goldfinchMock.setSharePrice(fp('1.01'))

      // Force updates
      await expect(newGspCollateral.refresh())
        .to.emit(newGspCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newGspCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newGspCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })
  })

  describe('Wrapper Reward Claims/Entitlements', () => {
    it('Should return greater entitlements for addr1 > addr2 > owner', async () => {
      const claimableAddr1Before = await gspWrapper.getClaimableRewards(addr1.address)
      const claimableAddr2Before = await gspWrapper.getClaimableRewards(addr2.address)

      // Advance time and blocks so rewards accumulate
      await advanceTime(300000)
      await advanceBlocks(1000)

      const claimableAddr1After = await gspWrapper.getClaimableRewards(addr1.address)
      const claimableAddr2After = await gspWrapper.getClaimableRewards(addr2.address)

      // Expect addr1 to have a greater claimable amount and both higher than before
      expect(claimableAddr1After).to.be.gt(claimableAddr2After)

      expect(claimableAddr1After).to.be.gt(claimableAddr1Before)
      expect(claimableAddr2After).to.be.gt(claimableAddr2Before)

      // Owner makes a deposit into the GoldfinchWrapper
      await gsp
        .connect(owner)
        .approve(gspWrapper.address, toBNDecimals(initialBal.div(2), 18).mul(100))
      await gspWrapper.connect(owner).deposit(owner.address, toBNDecimals(initialBal.div(2), 18))

      const claimableOwner = await gspWrapper.getClaimableRewards(owner.address)

      // Expect owner to have a smaller claimable amount than addr2 because of later deposit
      expect(claimableOwner).to.be.lt(claimableAddr2After)
    })

    it('Should claim token rewards from wrapper', async () => {
      const gfi = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.GFI || '')
      )

      const gfiAddr1BalanceBefore = await gfi.balanceOf(addr1.address)
      const gfiAddr2BalanceBefore = await gfi.balanceOf(addr2.address)

      // Advance time and blocks so rewards accumulate
      await advanceTime(300000)
      await advanceBlocks(1000)

      await gspWrapper.connect(addr1).claimRewards(true, addr1.address)
      await gspWrapper.connect(addr2).claimRewards(true, addr2.address)

      const gfiAddr1BalanceAfter = await gfi.balanceOf(addr1.address)
      const gfiAddr2BalanceAfter = await gfi.balanceOf(addr2.address)

      expect(gfiAddr1BalanceAfter).to.be.gt(gfiAddr1BalanceBefore)
      expect(gfiAddr2BalanceAfter).to.be.gt(gfiAddr2BalanceBefore)
      expect(gfiAddr1BalanceAfter).to.be.gt(gfiAddr2BalanceAfter)

      const claimableAddr1 = await gspWrapper.getClaimableRewards(addr1.address)
      const claimableAddr2 = await gspWrapper.getClaimableRewards(addr1.address)

      // No more rewards claimable right away
      expect(claimableAddr1).to.be.closeTo(bn('0'), fp('0.0001'))
      expect(claimableAddr2).to.be.closeTo(bn('0'), fp('0.0001'))
    })

    it('Should withdraw users balances from the wrapper', async () => {
      const gspWrapperAddr1BalanceBefore = await gspWrapper.balanceOf(addr1.address)
      const gspWrapperAddr2BalanceBefore = await gspWrapper.balanceOf(addr2.address)

      const gspAddr1BalanceBefore = await gsp.balanceOf(addr1.address)
      const gspAddr2BalanceBefore = await gsp.balanceOf(addr2.address)

      await gspWrapper.connect(addr1).withdraw(gspWrapperAddr1BalanceBefore)
      await gspWrapper.connect(addr2).withdraw(gspWrapperAddr2BalanceBefore)

      const gspWrapperAddr1BalanceAfter = await gspWrapper.balanceOf(addr1.address)
      const gspWrapperAddr2BalanceAfter = await gspWrapper.balanceOf(addr2.address)

      const gspAddr1BalanceAfter = await gsp.balanceOf(addr1.address)
      const gspAddr2BalanceAfter = await gsp.balanceOf(addr2.address)

      expect(gspWrapperAddr1BalanceAfter).to.eq(0)
      expect(gspWrapperAddr2BalanceAfter).to.eq(0)

      expect(gspAddr1BalanceAfter).to.be.gt(gspAddr1BalanceBefore)
      expect(gspAddr2BalanceAfter).to.be.gt(gspAddr2BalanceBefore)

      // Addr1 initially deposited double the amount of addr2
      expect(gspAddr1BalanceAfter).to.be.closeTo(gspAddr2BalanceAfter.mul(2), fp('10'))
    })
  })
})
