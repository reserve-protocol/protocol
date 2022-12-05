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
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  FraxSwapCollateral,
  FraxSwapPairMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  InvalidMockV3Aggregator,
  IFraxSwapRouter,
  OracleLib,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '../../../typechain'
import { getEtherscanBaseURL } from '../../../scripts/deployment/utils'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderFSFXSFRAX = '0x3f2e53b1a3036fd33f3c2f3cc49dab26a88df2e0'
// absolute 🐋
const fxsWhale = '0x66df2139c24446f5b43db80a680fb94d0c1c5d8e'
const fraxswapRouter = '0xC14d550632db8592D1243Edc8B95b0Ad06703867'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`FraxSwapCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let fxs: ERC20Mock
  let frax: ERC20Mock
  let fsFxsFrax: FraxSwapPairMock 
  let fraxSwapCollateral: FraxSwapCollateral
  // let compToken: ERC20Mock
  // let comptroller: ComptrollerMock
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

  let FraxSwapCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

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

    // FRAX token
    frax = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.FRAX || '')
    )
    fxs = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.FXS || '')
    )
    // fsFXSFRAX token
    fsFxsFrax = <FraxSwapPairMock>(
      await ethers.getContractAt('FraxSwapPairMock', networkConfig[chainId].tokens.fsFXSFRAX || '')
    )

    // Deploy fsFxsFrax collateral plugin
    FraxSwapCollateralFactory = await ethers.getContractFactory('FraxSwapCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    fraxSwapCollateral = <FraxSwapCollateral>(
      await FraxSwapCollateralFactory.deploy(
        fp('1'),
        2,
        networkConfig[chainId].chainlinkFeeds.FXS as string, // frax chainlink feed
        networkConfig[chainId].chainlinkFeeds.FRAX as string, // frax chainlink feed
        fsFxsFrax.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('FSV2SQRTFXSFRAX'),
        defaultThreshold,
        delayUntilDefault,
        {gasLimit: 5000000}
      )
    )

    await fraxSwapCollateral.deployed()

    // Setup balances for addr1 - Transfer from Mainnet holder
    // fsFXSFRAX
    initialBal = bn('100e18')
    
    await whileImpersonating(holderFSFXSFRAX, async (fsfxsfraxSigner) => {
      await fsFxsFrax.connect(fsfxsfraxSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [fraxSwapCollateral.address],
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
      // fsFXSFRAX (FraxSwapCollateral)
      expect(await fraxSwapCollateral.isCollateral()).to.equal(true)
      expect(await fraxSwapCollateral.erc20()).to.equal(fsFxsFrax.address)
      expect(await fsFxsFrax.decimals()).to.equal(18)
      expect(await fraxSwapCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('FSV2SQRTFXSFRAX'))
      expect(await fraxSwapCollateral.refPerTok()).to.be.closeTo(fp('1'), fp('0.01'))
      expect(await fraxSwapCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await fraxSwapCollateral.pricePerTarget()).to.be.closeTo(fp('1'), fp('0.01'))
      expect(await fraxSwapCollateral.prevReferencePrice()).to.equal(await fraxSwapCollateral.refPerTok())
      expect(await fraxSwapCollateral.strictPrice()).to.be.closeTo(fp('4.27'), fp('0.01')) // close to $4.27

      // TODO: Check claim data 
      // await expect(fraxSwapCollateral.claimRewards())
      //   .to.emit(undefined);
      expect(await fraxSwapCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(fsFxsFrax.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(fraxSwapCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(fraxSwapCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(fsFxsFrax.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('4.23'), fp('0.01'))


      // Check RToken price
      const issueAmount: BigNumber = bn('10e18')
      // await fsFxsFrax.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))
      await fsFxsFrax.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('4.23'), fp('0.01'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold

      await expect(
        FraxSwapCollateralFactory.deploy(
          fp('1'),
          2,
          networkConfig[chainId].chainlinkFeeds.FXS as string,
          networkConfig[chainId].chainlinkFeeds.FRAX as string,
          fsFxsFrax.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('FSV2SQRTFXSFRAX'),
          bn(0),
          delayUntilDefault,
        )
      ).to.be.revertedWith('defaultThreshold zero')


      await expect(
        FraxSwapCollateralFactory.deploy(
          fp('1'),
          4,
          networkConfig[chainId].chainlinkFeeds.FXS as string,
          networkConfig[chainId].chainlinkFeeds.FRAX as string,
          fsFxsFrax.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('FSV2SQRTFXSFRAX'),
          defaultThreshold,
          delayUntilDefault,
        )
      ).to.be.revertedWith('invalid tokenisFiat bitmap')

    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      // await fsFxsFrax.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))
      await fsFxsFrax.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1fFxsFrax: BigNumber = await fsFxsFrax.balanceOf(addr1.address)

      // Check rates and prices
      const fFxsFraxPrice1: BigNumber = await fraxSwapCollateral.strictPrice() // ~ $4.274
      const fFxsFraxRefPerTok1: BigNumber = await fraxSwapCollateral.refPerTok() // ~ 1.00939

      expect(fFxsFraxPrice1).to.be.closeTo(fp('4.2740'), fp('0.0001'))
      expect(fFxsFraxRefPerTok1).to.be.closeTo(fp('1.00939'), fp('0.000006'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(fp('42.3'), fp('0.05')) // approx $42.3 in value

      //perform swap - increasing refPerTok()
      const router = <IFraxSwapRouter>(
        await ethers.getContractAt("IFraxSwapRouter", fraxswapRouter)
      )

      await whileImpersonating(fxsWhale, async (fxsWhaleSigner) => {
        await fxs.connect(addr1).approve(router.address, ethers.constants.MaxUint256)
        await frax.connect(addr1).approve(router.address, ethers.constants.MaxUint256)
        await fxs.connect(fxsWhaleSigner).transfer(addr1.address, bn('2e24')) // big stacks omegalol
        // swap fxs <-> frax back and forth 10 times (lol) -> the fees paid should increase refPerTok()
        let addr1FxsBal
        let addr1FraxBal
        for (let i = 0; i < 10; i++) {
         addr1FxsBal = await fxs.balanceOf(addr1.address)

          await router.connect(addr1).swapExactTokensForTokens(
            addr1FxsBal, 
            fp('1'),  // high slippage is fine, the idea is to increase refPerTok drastically lol
            [fxs.address, frax.address],
            addr1.address, 
            1669251833, //random deadline lol
          )

          addr1FraxBal = await frax.balanceOf(addr1.address)

          await router.connect(addr1).swapExactTokensForTokens(
            addr1FraxBal,
            fp('1'),  // high slippage is fine, the idea is to increase refPerTok drastically lol
            [frax.address, fxs.address],
            addr1.address, 
            1669251833, //random deadline lol
          )
        }

      })

      await advanceTime(100)
      await advanceBlocks(100)

      // Refresh cToken manually (required)
      await fraxSwapCollateral.refresh()
      expect(await fraxSwapCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const fFxsFraxPrice2: BigNumber = await fraxSwapCollateral.strictPrice() // ~$4.32
      const fFxsFraxRefPerTok2: BigNumber = await fraxSwapCollateral.refPerTok() // ~1.0205

      // Check rates and price increase
      expect(fFxsFraxPrice2).to.be.gt(fFxsFraxPrice1)
      expect(fFxsFraxRefPerTok2).to.be.gt(fFxsFraxRefPerTok1)

      expect(fFxsFraxPrice2).to.be.closeTo(fp('4.321'), fp('0.001'))
      expect(fFxsFraxRefPerTok2).to.be.closeTo(fp('1.0205'), fp('0.00001'))

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
      const newBalanceAddr1fFxsFrax: BigNumber = await fsFxsFrax.balanceOf(addr1.address)

      // Check received tokens represent ~$42.7 in value at current prices
      expect(newBalanceAddr1fFxsFrax.sub(balanceAddr1fFxsFrax)).to.be.closeTo(bn('9.8e18'), bn('0.1e18'))

      // Check remainders in Backing Manager
      expect(await fsFxsFrax.balanceOf(backingManager.address)).to.be.closeTo(bn('0.1e18'), bn('0.01e18'))

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('0.46'), // ~= 0.86 usd (from above)
        fp('0.01')
      )
    })
  })

  // TODO: check for rewards
  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  // describe('Rewards', () => {
  //   it('Should be able to claim rewards (if applicable)', async () => {
  //     const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
  //     const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

  //     // Try to claim rewards at this point - Nothing for Backing Manager
  //     expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

  //     await expectEvents(backingManager.claimRewards(), [
  //       {
  //         contract: backingManager,
  //         name: 'RewardsClaimed',
  //         args: [compToken.address, bn(0)],
  //         emitted: true,
  //       },
  //     ])

  //     // No rewards so far
  //     expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

  //     // Provide approvals for issuances
  //     await fsFxsFrax.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

  //     // Issue rTokens
  //     await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

  //     // Check RTokens issued to user
  //     expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

  //     // Now we can claim rewards - check initial balance still 0
  //     expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

  //     // Advance Time
  //     await advanceTime(8000)

  //     // Claim rewards
  //     await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

  //     // Check rewards both in COMP and stkAAVE
  //     const rewardsCOMP1: BigNumber = await compToken.balanceOf(backingManager.address)

  //     expect(rewardsCOMP1).to.be.gt(0)

  //     // Keep moving time
  //     await advanceTime(3600)

  //     // Get additional rewards
  //     await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

  //     const rewardsCOMP2: BigNumber = await compToken.balanceOf(backingManager.address)

  //     expect(rewardsCOMP2.sub(rewardsCOMP1)).to.be.gt(0)
  //   })
  // })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expect(fraxSwapCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await fraxSwapCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await fraxSwapCollateral.refresh()
      expect(await fraxSwapCollateral.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceCtokenCollateral: FraxSwapCollateral = <FraxSwapCollateral>await (
        await ethers.getContractFactory('FraxSwapCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        2,
        NO_PRICE_DATA_FEED, // TODO: figure out how this should be configured
        NO_PRICE_DATA_FEED,
        fsFxsFrax.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('FSV2SQRTFXSFRAX'),
        defaultThreshold,
        delayUntilDefault,
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceCtokenCollateral: FraxSwapCollateral = <FraxSwapCollateral>await (
        await ethers.getContractFactory('FraxSwapCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        2,
        mockChainlinkFeed.address, // TODO: figure out how this should be configured
        mockChainlinkFeed.address,
        fsFxsFrax.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('FSV2SQRTFXSFRAX'),
        defaultThreshold,
        delayUntilDefault,
      )

      await setOraclePrice(invalidpriceCtokenCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceCtokenCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceCtokenCollateral.refresh()
      expect(await invalidpriceCtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // Test for soft default
    it('Updates status in case of soft default', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const newFraxSwapCollateral: FraxSwapCollateral = <FraxSwapCollateral>await (
        await ethers.getContractFactory('FraxSwapCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        2, // token0 is non-fiat, while token1 is
        mockChainlinkFeed.address,
        mockChainlinkFeed.address,
        await fraxSwapCollateral.erc20(),
        await fraxSwapCollateral.maxTradeVolume(),
        await fraxSwapCollateral.oracleTimeout(),
        await fraxSwapCollateral.targetName(),
        await fraxSwapCollateral.defaultThreshold(),
        await fraxSwapCollateral.delayUntilDefault(),
      )

      // Check initial state
      expect(await newFraxSwapCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newFraxSwapCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg token1 (a fiat) Reducing price 20%
      await setOraclePrice(newFraxSwapCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newFraxSwapCollateral.refresh())
        .to.emit(newFraxSwapCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newFraxSwapCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newFraxSwapCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newFraxSwapCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newFraxSwapCollateral.whenDefault()
      await expect(newFraxSwapCollateral.refresh()).to.not.emit(
        newFraxSwapCollateral,
        'DefaultStatusChanged'
      )
      expect(await newFraxSwapCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newFraxSwapCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const FraxSwapPairMockFactory: ContractFactory = await ethers.getContractFactory('FraxSwapPairMock')
      const symbol = await fsFxsFrax.symbol()
      const fFxsFraxMock: FraxSwapPairMock = <FraxSwapPairMock>(
        await FraxSwapPairMockFactory.deploy(
          symbol + ' Token', 
          symbol, 
          networkConfig[chainId].tokens.FXS as string,
          networkConfig[chainId].tokens.FRAX as string,
          100, // fee in basis points, 100bp = 1%
          fp('10000'),
          fp('42700') // 4x more FRAX than FXS, so FXS -> FRAX exchange rate is ~4.27 FRAX ($4.27)
        )
      )

      // Redeploy plugin using the new fsFxsFrax mock
      const newFraxSwapCollateral: FraxSwapCollateral = <FraxSwapCollateral>await (
        await ethers.getContractFactory('FraxSwapCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        2,
        await fraxSwapCollateral.token0chainlinkFeed(),
        await fraxSwapCollateral.token1chainlinkFeed(),
        fFxsFraxMock.address,
        await fraxSwapCollateral.maxTradeVolume(),
        await fraxSwapCollateral.oracleTimeout(),
        await fraxSwapCollateral.targetName(),
        await fraxSwapCollateral.defaultThreshold(),
        await fraxSwapCollateral.delayUntilDefault(),
        {gasLimit: 5000000}
      )

      // Check initial state
      expect(await newFraxSwapCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newFraxSwapCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for fsFXSFRAX, will disable collateral immediately
      // this is done here by making liquidity just disappear from the fraxswap
      // pool without changing the supply of shares lol.
      await fFxsFraxMock.manipulateReserves(fp('1000'), fp('42700')) // each token supplies are down by 90%, oof!

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newFraxSwapCollateral.refresh())
        .to.emit(newFraxSwapCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newFraxSwapCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newFraxSwapCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidFraxSwapCollateral: FraxSwapCollateral = <FraxSwapCollateral>(
        await FraxSwapCollateralFactory.deploy(
          fp('1'),
          2,
          invalidChainlinkFeed.address,
          invalidChainlinkFeed.address,
          await fraxSwapCollateral.erc20(),
          await fraxSwapCollateral.maxTradeVolume(),
          await fraxSwapCollateral.oracleTimeout(),
          await fraxSwapCollateral.targetName(),
          await fraxSwapCollateral.defaultThreshold(),
          await fraxSwapCollateral.delayUntilDefault(),
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidFraxSwapCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidFraxSwapCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidFraxSwapCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidFraxSwapCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})
