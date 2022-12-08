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
  ArrakisVaultCollateral,
  ArrakisVaultMock,
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
  ISwapRouter,
} from '../../../typechain'
import { useEnv } from '#/utils/env'
import forkBlockNumber from '../fork-block-numbers'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderUSDCWETH = '0xCB16F82E5949975f9Cf229C91c3A6D43e3B32a9E'
// absolute 🐋
const wethWhale = '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'
const swapRouter = '0xE592427A0AEce92De3Edee1F18E0157C05861564'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

// const describeFork = process.env.FORK ? describe : describe.skip
const describeFork = useEnv('FORK') ? describe : describe.skip

const MAINNET_RPC_URL = useEnv(['MAINNET_RPC_URL', 'ALCHEMY_MAINNET_RPC_URL'])

describeFork(`ArrakisVaultCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let weth: ERC20Mock
  let usdc: ERC20Mock
  let arrakisUsdcWeth: ArrakisVaultMock 
  let arrakisVaultCollateral: ArrakisVaultCollateral
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

  let ArrakisVaultCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

      // Fork at designated block number - REQUIRED
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{forking: {
            jsonRpcUrl: MAINNET_RPC_URL,
            blockNumber: forkBlockNumber['arrakis-plugins']
          },},],
      });

    expect(await ethers.provider.getBlockNumber()).to.equal(forkBlockNumber['arrakis-plugins'])
  
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // USDC token
    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )
    weth = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.WETH || '')
    )
    // arrakisUSDCWETH token
    arrakisUsdcWeth = <ArrakisVaultMock>(
      await ethers.getContractAt('ArrakisVaultMock', networkConfig[chainId].tokens.arrakisUSDCWETH || '')
    )

    // Deploy arrakisUsdcWeth collateral plugin
    ArrakisVaultCollateralFactory = await ethers.getContractFactory('ArrakisVaultCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    arrakisVaultCollateral = <ArrakisVaultCollateral>(
      await ArrakisVaultCollateralFactory.deploy(
        fp('1'),
        1,
        networkConfig[chainId].chainlinkFeeds.USDC as string, // usdc chainlink feed
        networkConfig[chainId].chainlinkFeeds.ETH as string, // weth (eth) chainlink feed 
        arrakisUsdcWeth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ASSQRTUSDCWETH'),
        defaultThreshold,
        delayUntilDefault,
        {gasLimit: 5000000}
      )
    )

    await arrakisVaultCollateral.deployed()

    // Setup balances for addr1 - Transfer from Mainnet holder
    // arrakisUSDCWETH
    initialBal = bn('500e13')
    
    await whileImpersonating(holderUSDCWETH, async (asusdcwethSigner) => {
      await arrakisUsdcWeth.connect(asusdcwethSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [arrakisVaultCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries:[],
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
      // arrakisUSDCWETH (ArrakisVaultCollateral)
      expect(await arrakisVaultCollateral.isCollateral()).to.equal(true)
      expect(await arrakisVaultCollateral.erc20()).to.equal(arrakisUsdcWeth.address)
      expect(await arrakisUsdcWeth.decimals()).to.equal(18)
      expect(await arrakisVaultCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ASSQRTUSDCWETH'))
      expect(await arrakisVaultCollateral.refPerTok()).to.be.closeTo(fp('0.01114'), fp('0.00001'))
      expect(await arrakisVaultCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await arrakisVaultCollateral.pricePerTarget()).to.be.closeTo(fp('1'), fp('0.01'))
      expect(await arrakisVaultCollateral.prevReferencePrice()).to.equal(await arrakisVaultCollateral.refPerTok())
      expect(await arrakisVaultCollateral.strictPrice()).to.be.closeTo(fp('5301000'), fp('1000')) // close to $4.27

      // TODO: Check claim data 
      // await expect(arrakisVaultCollateral.claimRewards())
      //   .to.emit(undefined);
      expect(await arrakisVaultCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(arrakisUsdcWeth.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(arrakisVaultCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(arrakisVaultCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(arrakisUsdcWeth.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      //TODO: shouldn't this be the same as strictPrice()?
      expect(price).to.be.closeTo(fp('475618000'), fp('1000'))


      // Check RToken price
      const issueAmount: BigNumber = bn('1e13')
      // await arrakisUsdcWeth.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))
      await arrakisUsdcWeth.connect(addr1).approve(rToken.address, ethers.constants.MaxUint256)
      const bal = await arrakisUsdcWeth.balanceOf(addr1.address)
      console.log('balance:')
      console.log(bal.toString())
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('475618000'), fp('1000'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold

      await expect(
        ArrakisVaultCollateralFactory.deploy(
          fp('1'),
          2,
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          arrakisUsdcWeth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ASSQRTUSDCWETH'),
          bn(0),
          delayUntilDefault,
        )
      ).to.be.revertedWith('defaultThreshold zero')


      await expect(
        ArrakisVaultCollateralFactory.deploy(
          fp('1'),
          4,
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          arrakisUsdcWeth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ASSQRTUSDCWETH'),
          defaultThreshold,
          delayUntilDefault,
        )
      ).to.be.revertedWith('invalid tokenisFiat bitmap')

    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('1e13')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      // await arrakisUsdcWeth.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))
      await arrakisUsdcWeth.connect(addr1).approve(rToken.address, ethers.constants.MaxUint256)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1aUsdcWeth: BigNumber = await arrakisUsdcWeth.balanceOf(addr1.address)

      // Check rates and prices
      const aUsdcWethPrice1: BigNumber = await arrakisVaultCollateral.strictPrice() // ~ $4.274
      const aUsdcWethRefPerTok1: BigNumber = await arrakisVaultCollateral.refPerTok() // ~ 1.00939

      expect(aUsdcWethPrice1).to.be.closeTo(fp('5301000'), fp('1000'))
      expect(aUsdcWethRefPerTok1).to.be.closeTo(fp('0.01114'), fp('0.00001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(fp('4756'), fp('1')) // approx $42.3 in value

      //perform swap - increasing refPerTok()
      const router = <ISwapRouter>(
        await ethers.getContractAt("ISwapRouter", swapRouter)
      )

      await whileImpersonating(wethWhale, async (wethWhaleSigner) => {
        await weth.connect(addr1).approve(router.address, ethers.constants.MaxUint256)
        await usdc.connect(addr1).approve(router.address, ethers.constants.MaxUint256)
        await weth.connect(wethWhaleSigner).transfer(addr1.address, bn('10e18')) // big stacks omegalol
        console.log('transferred')
        // swap weth <-> usdc back and forth 10 times (lol) -> the fees paid should increase refPerTok()
        let addr1WethBal
        for (let i = 0; i < 3; i++) {
          addr1WethBal = await weth.balanceOf(addr1.address)

          const inputParams = 
          {
            path: [weth.address, usdc.address],
            recipient: addr1.address,
            deadline: 9999999999, // long deadline lol
            amountInMaximum: 1,
            amountOutMinimum: 100,
          }

          await router.connect(addr1).exactInput(
            inputParams
          )


        }

      })

      await advanceTime(100)
      await advanceBlocks(100)

      // Refresh cToken manually (required)
      await arrakisVaultCollateral.refresh()
      expect(await arrakisVaultCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const aUsdcWethPrice2: BigNumber = await arrakisVaultCollateral.strictPrice() // ~$4.32
      const aUsdcWethRefPerTok2: BigNumber = await arrakisVaultCollateral.refPerTok() // ~1.0205

      // Check rates and price increase
      expect(aUsdcWethPrice2).to.be.gt(aUsdcWethPrice1)
      expect(aUsdcWethRefPerTok2).to.be.gt(aUsdcWethRefPerTok1)

      expect(aUsdcWethPrice2).to.be.closeTo(fp('4.321'), fp('0.001'))
      expect(aUsdcWethRefPerTok2).to.be.closeTo(fp('1.0205'), fp('0.00001'))

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
      const newBalanceAddr1aUsdcWeth: BigNumber = await arrakisUsdcWeth.balanceOf(addr1.address)

      // Check received tokens represent ~$42.7 in value at current prices
      expect(newBalanceAddr1aUsdcWeth.sub(balanceAddr1aUsdcWeth)).to.be.closeTo(bn('9.8e18'), bn('0.1e18'))

      // Check remainders in Backing Manager
      expect(await arrakisUsdcWeth.balanceOf(backingManager.address)).to.be.closeTo(bn('0.1e18'), bn('0.01e18'))

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
  //     await arrakisUsdcWeth.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

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
      await expect(arrakisVaultCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await arrakisVaultCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await arrakisVaultCollateral.refresh()
      expect(await arrakisVaultCollateral.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceCtokenCollateral: ArrakisVaultCollateral = <ArrakisVaultCollateral>await (
        await ethers.getContractFactory('ArrakisVaultCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        1,
        NO_PRICE_DATA_FEED, // TODO: figure out how this should be configured
        NO_PRICE_DATA_FEED,
        arrakisUsdcWeth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ASSQRTUSDCWETH'),
        defaultThreshold,
        delayUntilDefault,
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceCtokenCollateral: ArrakisVaultCollateral = <ArrakisVaultCollateral>await (
        await ethers.getContractFactory('ArrakisVaultCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        1,
        mockChainlinkFeed.address, // TODO: figure out how this should be configured
        mockChainlinkFeed.address,
        arrakisUsdcWeth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ASSQRTUSDCWETH'),
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
      const newArrakisVaultCollateral: ArrakisVaultCollateral = <ArrakisVaultCollateral>await (
        await ethers.getContractFactory('ArrakisVaultCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        1, // token0 is non-fiat, while token1 is
        mockChainlinkFeed.address,
        mockChainlinkFeed.address,
        await arrakisVaultCollateral.erc20(),
        await arrakisVaultCollateral.maxTradeVolume(),
        await arrakisVaultCollateral.oracleTimeout(),
        await arrakisVaultCollateral.targetName(),
        await arrakisVaultCollateral.defaultThreshold(),
        await arrakisVaultCollateral.delayUntilDefault(),
      )

      // Check initial state
      expect(await newArrakisVaultCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newArrakisVaultCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg token1 (a fiat) Reducing price 20%
      await setOraclePrice(newArrakisVaultCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newArrakisVaultCollateral.refresh())
        .to.emit(newArrakisVaultCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newArrakisVaultCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newArrakisVaultCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newArrakisVaultCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newArrakisVaultCollateral.whenDefault()
      await expect(newArrakisVaultCollateral.refresh()).to.not.emit(
        newArrakisVaultCollateral,
        'CollateralStatusChanged'
      )
      expect(await newArrakisVaultCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newArrakisVaultCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const FraxSwapPairMockFactory: ContractFactory = await ethers.getContractFactory('FraxSwapPairMock')
      const symbol = await arrakisUsdcWeth.symbol()
      const aUsdcWethMock: FraxSwapPairMock = <FraxSwapPairMock>(
        await FraxSwapPairMockFactory.deploy(
          symbol + ' Token', 
          symbol, 
          networkConfig[chainId].tokens.WETH as string,
          networkConfig[chainId].tokens.USDC as string,
          100, // fee in basis points, 100bp = 1%
          fp('10000'),
          fp('42700') // 4x more USDC than WETH, so WETH -> USDC exchange rate is ~4.27 USDC ($4.27)
        )
      )

      // Redeploy plugin using the new arrakisUsdcWeth mock
      const newArrakisVaultCollateral: ArrakisVaultCollateral = <ArrakisVaultCollateral>await (
        await ethers.getContractFactory('ArrakisVaultCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        1,
        await arrakisVaultCollateral.token0chainlinkFeed(),
        await arrakisVaultCollateral.token1chainlinkFeed(),
        aUsdcWethMock.address,
        await arrakisVaultCollateral.maxTradeVolume(),
        await arrakisVaultCollateral.oracleTimeout(),
        await arrakisVaultCollateral.targetName(),
        await arrakisVaultCollateral.defaultThreshold(),
        await arrakisVaultCollateral.delayUntilDefault(),
        {gasLimit: 5000000}
      )

      // Check initial state
      expect(await newArrakisVaultCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newArrakisVaultCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for arrakisUSDCWETH, will disable collateral immediately
      // this is done here by making liquidity just disappear from the usdcswap
      // pool without changing the supply of shares lol.
      await aUsdcWethMock.manipulateReserves(fp('1000'), fp('42700')) // each token supplies are down by 90%, oof!

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newArrakisVaultCollateral.refresh())
        .to.emit(newArrakisVaultCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newArrakisVaultCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newArrakisVaultCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidArrakisVaultCollateral: ArrakisVaultCollateral = <ArrakisVaultCollateral>(
        await ArrakisVaultCollateralFactory.deploy(
          fp('1'),
          2,
          invalidChainlinkFeed.address,
          invalidChainlinkFeed.address,
          await arrakisVaultCollateral.erc20(),
          await arrakisVaultCollateral.maxTradeVolume(),
          await arrakisVaultCollateral.oracleTimeout(),
          await arrakisVaultCollateral.targetName(),
          await arrakisVaultCollateral.defaultThreshold(),
          await arrakisVaultCollateral.delayUntilDefault(),
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidArrakisVaultCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidArrakisVaultCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidArrakisVaultCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidArrakisVaultCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})
