import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import {
  IMPLEMENTATION,
  Implementation,
  ORACLE_ERROR,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
} from '../../../fixtures'
import {
  DefaultFixture,
  Fixture,
  getDefaultFixture,
  DECAY_DELAY,
  ORACLE_TIMEOUT,
} from '../fixtures'
import { getChainId } from '../../../../common/blockchain-utils'
import forkBlockNumber from '../../../integration/fork-block-numbers'
import {
  IConfig,
  IGovParams,
  IGovRoles,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../../common/configuration'
import {
  CollateralStatus,
  MAX_UINT48,
  MAX_UINT192,
  ZERO_ADDRESS,
} from '../../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../../common/events'
import { bn, fp } from '../../../../common/numbers'
import { whileImpersonating } from '../../../utils/impersonation'
import {
  expectPrice,
  expectRTokenPrice,
  setOraclePrice,
  expectUnpriced,
} from '../../../utils/oracles'
import {
  advanceBlocks,
  advanceTime,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '../../../utils/time'
import {
  Asset,
  ATokenFiatCollateral,
  ERC20Mock,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIFacade,
  TestIMain,
  TestIRToken,
  IAToken,
  StaticATokenLM,
  StaticATokenMock,
  AggregatorInterface,
} from '../../../../typechain'
import { useEnv } from '#/utils/env'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import snapshotGasCost from '../../../utils/snapshotGasCost'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

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

// Holder address in Mainnet
const holderDai = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`ATokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let dai: ERC20Mock
  let aDai: IAToken
  let staticAToken: StaticATokenLM
  let aDaiCollateral: ATokenFiatCollateral
  let stkAave: ERC20Mock
  let stkAaveAsset: Asset
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Core Contracts
  let main: TestIMain
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let chainlinkFeed: AggregatorInterface

  let deployer: TestIDeployer
  let facade: TestIFacade
  let facadeTest: FacadeTest
  let facadeWrite: FacadeWrite
  let govParams: IGovParams
  let govRoles: IGovRoles

  // RToken Configuration
  const dist: IRevenueShare = {
    rTokenDist: bn(4000), // 2/5 RToken
    rsrDist: bn(6000), // 3/5 RSR
  }
  const config: IConfig = {
    dist: dist,
    minTradeVolume: fp('1e4'), // $10k
    rTokenMaxTradeVolume: fp('1e6'), // $1M
    shortFreeze: bn('259200'), // 3 days
    longFreeze: bn('2592000'), // 30 days
    rewardRatio: bn('89139297916'), // per second. approx half life of 90 days
    unstakingDelay: bn('1209600'), // 2 weeks
    withdrawalLeak: fp('0'), // 0%; always refresh
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    batchAuctionLength: bn('900'), // 15 minutes
    dutchAuctionLength: bn('1800'), // 30 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceThrottle: {
      amtRate: fp('1e6'), // 1M RToken
      pctRate: fp('0.05'), // 5%
    },
    redemptionThrottle: {
      amtRate: fp('1e6'), // 1M RToken
      pctRate: fp('0.05'), // 5%
    },
    warmupPeriod: bn('60'),
    reweightable: false,
  }

  const defaultThreshold = fp('0.01') // 1%
  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let chainId: number

  let ATokenFiatCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  let defaultFixture: Fixture<DefaultFixture>

  before(async () => {
    await setup(forkBlockNumber['adai-plugin'])
    defaultFixture = await getDefaultFixture('atoken')
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

    // DAI token
    dai = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI || '')
    )
    // aDAI token
    aDai = <IAToken>(
      await ethers.getContractAt(
        '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
        networkConfig[chainId].tokens.aDAI || ''
      )
    )

    // stkAAVE
    stkAave = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.stkAAVE || '')
    )

    // Create stkAAVE asset
    stkAaveAsset = <Asset>(
      await (
        await ethers.getContractFactory('Asset')
      ).deploy(
        PRICE_TIMEOUT,
        networkConfig[chainId].chainlinkFeeds.AAVE || '',
        ORACLE_ERROR,
        stkAave.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT
      )
    )

    const StaticATokenFactory: ContractFactory = await ethers.getContractFactory('StaticATokenLM')

    staticAToken = <StaticATokenLM>(
      await StaticATokenFactory.connect(owner).deploy(
        networkConfig[chainId].AAVE_LENDING_POOL,
        networkConfig[chainId].tokens.aDAI,
        'Static Aave Interest Bearing DAI',
        'stataDAI'
      )
    )

    // Deploy aDai collateral plugin
    ATokenFiatCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral')
    aDaiCollateral = <ATokenFiatCollateral>await ATokenFiatCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI as string,
        oracleError: ORACLE_ERROR,
        erc20: staticAToken.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      REVENUE_HIDING
    )

    chainlinkFeed = await ethers.getContractAt(
      'AggregatorInterface',
      networkConfig[chainId].chainlinkFeeds.DAI as string
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // aDAI
    initialBal = bn('2000000e18')
    await whileImpersonating(holderDai, async (daiSigner) => {
      await dai.connect(daiSigner).transfer(addr1.address, initialBal)
    })

    const initialBalDai = await dai.balanceOf(addr1.address)

    await dai.connect(addr1).approve(staticAToken.address, initialBalDai)
    await staticAToken.connect(addr1).deposit(addr1.address, initialBalDai, 0, true)

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [stkAaveAsset.address],
      primaryBasket: [aDaiCollateral.address],
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

    // Set initial governance roles
    govRoles = {
      owner: owner.address,
      guardian: ZERO_ADDRESS,
      pausers: [],
      shortFreezers: [],
      longFreezers: [],
    }

    // Setup owner and unpause
    await facadeWrite.connect(owner).setupGovernance(
      rToken.address,
      false, // do not deploy governance
      true, // unpaused
      govParams, // mock values, not relevant
      govRoles
    )

    // Setup mock chainlink feed for some of the tests (so we can change the value)
    MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Rewards assets (if applies)
      // stkAAVE Asset
      expect(await stkAaveAsset.isCollateral()).to.equal(false)
      expect(await stkAaveAsset.erc20()).to.equal(stkAave.address)
      expect(await stkAaveAsset.erc20()).to.equal(networkConfig[chainId].tokens.stkAAVE)
      expect(await stkAave.decimals()).to.equal(18)
      await expectPrice(stkAaveAsset.address, fp('169.05235423'), ORACLE_ERROR, true)
      await expect(stkAaveAsset.claimRewards()).to.not.emit(stkAaveAsset, 'RewardsClaimed')
      expect(await stkAaveAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      const refPerTok = await aDaiCollateral.refPerTok()
      // Check Collateral plugin
      // aDAI (ATokenFiatCollateral)
      expect(await aDaiCollateral.isCollateral()).to.equal(true)
      expect(await aDaiCollateral.erc20()).to.equal(staticAToken.address)
      const aDaiErc20 = await ethers.getContractAt('ERC20Mock', aDai.address)
      expect(await aDaiErc20.decimals()).to.equal(18)
      expect(await staticAToken.decimals()).to.equal(18)
      expect(await aDaiCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(refPerTok).to.be.closeTo(fp('1.066'), fp('0.001'))
      expect(await aDaiCollateral.targetPerRef()).to.equal(fp('1'))

      const answer = await chainlinkFeed.latestAnswer()

      await expectPrice(
        aDaiCollateral.address,
        answer
          .mul(10 ** 10)
          .mul(refPerTok)
          .div(fp('1')),
        ORACLE_ERROR,
        true,
        bn('1e5')
      ) // close to $0.022 cents

      // Check claim data
      await expect(staticAToken['claimRewards()']())
        .to.emit(staticAToken, 'RewardsClaimed')
        .withArgs(stkAave.address, anyValue)

      await expect(aDaiCollateral.claimRewards())
        .to.emit(aDaiCollateral, 'RewardsClaimed')
        .withArgs(stkAave.address, anyValue)
      expect(await aDaiCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(stkAave.address)
      expect(ERC20s[3]).to.equal(staticAToken.address)
      expect(ERC20s.length).to.eql(4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(stkAaveAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(aDaiCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(aDaiCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(staticAToken.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // TODO: confirm this is right
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true, bn('1000'))

      // Check RToken price
      const issueAmount: BigNumber = bn('10000e18')
      await staticAToken.connect(addr1).approve(rToken.address, issueAmount.mul(100))
      await advanceTime(3600)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Missing erc20
      await expect(
        ATokenFiatCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI as string,
            oracleError: ORACLE_ERROR,
            erc20: ZERO_ADDRESS,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          REVENUE_HIDING
        )
      ).to.be.revertedWith('missing erc20')

      // defaultThreshold = 0
      await expect(
        ATokenFiatCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI as string,
            oracleError: ORACLE_ERROR,
            erc20: staticAToken.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold: bn(0),
            delayUntilDefault,
          },
          REVENUE_HIDING
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await staticAToken.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      await advanceTime(3600)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1aDai: BigNumber = await staticAToken.balanceOf(addr1.address)

      // Check rates and prices
      const [aDaiPriceLow1, aDaiPriceHigh1] = await aDaiCollateral.price()
      const aDaiRefPerTok1: BigNumber = await aDaiCollateral.refPerTok()
      let answer = await chainlinkFeed.latestAnswer()

      await expectPrice(
        aDaiCollateral.address,
        answer
          .mul(10 ** 10)
          .mul(aDaiRefPerTok1)
          .div(fp(1)),
        ORACLE_ERROR,
        true,
        bn('1e5')
      )
      expect(aDaiRefPerTok1).to.be.closeTo(fp('1.066'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await aDaiCollateral.refresh()
      expect(await aDaiCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const [aDaiPriceLow2, aDaiPriceHigh2] = await aDaiCollateral.price() // ~0.022016
      const aDaiRefPerTok2: BigNumber = await aDaiCollateral.refPerTok() // ~0.022016

      // Check rates and price increase
      expect(aDaiPriceLow2).to.be.gt(aDaiPriceLow1)
      expect(aDaiPriceHigh2).to.be.gt(aDaiPriceHigh1)
      expect(aDaiRefPerTok2).to.be.gt(aDaiRefPerTok1)

      answer = await chainlinkFeed.latestAnswer()

      // Still close to the original values
      await expectPrice(
        aDaiCollateral.address,
        answer
          .mul(10 ** 10)
          .mul(aDaiRefPerTok2)
          .div(fp(1)),
        ORACLE_ERROR,
        true,
        bn('1e5')
      )
      expect(aDaiRefPerTok2).to.be.closeTo(fp('1.066'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await aDaiCollateral.refresh()
      expect(await aDaiCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const [aDaiPriceLow3, aDaiPriceHigh3] = await aDaiCollateral.price()
      const aDaiRefPerTok3: BigNumber = await aDaiCollateral.refPerTok()

      // Check rates and price increase
      expect(aDaiPriceLow3).to.be.gt(aDaiPriceLow2)
      expect(aDaiPriceHigh3).to.be.gt(aDaiPriceHigh2)
      expect(aDaiRefPerTok3).to.be.gt(aDaiRefPerTok2)

      answer = await chainlinkFeed.latestAnswer()

      await expectPrice(
        aDaiCollateral.address,
        answer
          .mul(10 ** 10)
          .mul(aDaiRefPerTok3)
          .div(fp(1)),
        ORACLE_ERROR,
        true,
        bn('1e5')
      )
      expect(aDaiRefPerTok3).to.be.closeTo(fp('1.217'), fp('0.001'))

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

      // Check balances - Fewer aTokens should have been sent to the user
      const newBalanceAddr1aDai: BigNumber = await staticAToken.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1aDai.sub(balanceAddr1aDai)).to.be.closeTo(bn('8212.4e18'), fp('0.1'))

      // Check remainders in Backing Manager
      expect(await staticAToken.balanceOf(backingManager.address)).to.be.closeTo(
        bn('1165.8e18'),
        fp('0.1')
      )

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        bn('1420.0e18'),
        fp('0.1')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await stkAave.balanceOf(backingManager.address)).to.equal(0)

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [stkAave.address, anyValue],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await stkAave.balanceOf(backingManager.address)).to.equal(0)

      // Provide approvals for issuances
      await staticAToken.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      await advanceTime(3600)
      await advanceBlocks(300)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Now we can claim rewards - check initial balance still 0
      expect(await stkAave.balanceOf(backingManager.address)).to.equal(0)

      // Advance Time
      await advanceTime(12000)
      await advanceBlocks(1000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Check rewards both in stkAAVE and stkAAVE
      const rewardsstkAAVE1: BigNumber = await stkAave.balanceOf(backingManager.address)

      expect(rewardsstkAAVE1).to.be.gt(0)

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      const rewardsstkAAVE2: BigNumber = await stkAave.balanceOf(backingManager.address)

      expect(rewardsstkAAVE2.sub(rewardsstkAAVE1)).to.be.gt(0)
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Does not revert with stale price
      await advanceTime(DECAY_DELAY.sub(12).toString())

      // Price is at saved prices
      const savedLowPrice = await aDaiCollateral.savedLowPrice()
      const savedHighPrice = await aDaiCollateral.savedHighPrice()
      const p = await aDaiCollateral.price()
      expect(p[0]).to.equal(savedLowPrice)
      expect(p[1]).to.equal(savedHighPrice)

      // Refresh should mark status IFFY
      await aDaiCollateral.refresh()
      expect(await aDaiCollateral.status()).to.equal(CollateralStatus.IFFY)

      // aTokens Collateral with no price
      const nonpriceCtokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
        await ethers.getContractFactory('ATokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: NO_PRICE_DATA_FEED,
          oracleError: ORACLE_ERROR,
          erc20: staticAToken.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        },
        REVENUE_HIDING
      )

      // aTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.price()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Does not revert with zero price
      const zeropriceCtokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
        await ethers.getContractFactory('ATokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: staticAToken.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        },
        REVENUE_HIDING
      )

      await setOraclePrice(zeropriceCtokenCollateral.address, bn(0))

      // Unpriced
      await expectUnpriced(zeropriceCtokenCollateral.address)

      // Refresh should mark status IFFY
      await zeropriceCtokenCollateral.refresh()
      expect(await zeropriceCtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('lotPrice (deprecated) is equal to price()', async () => {
      const lotPrice = await aDaiCollateral.lotPrice()
      const price = await aDaiCollateral.price()
      expect(price.length).to.equal(2)
      expect(lotPrice.length).to.equal(price.length)
      expect(lotPrice[0]).to.equal(price[0])
      expect(lotPrice[1]).to.equal(price[1])
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
      const newADaiCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
        await ethers.getContractFactory('ATokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: await aDaiCollateral.erc20(),
          maxTradeVolume: await aDaiCollateral.maxTradeVolume(),
          oracleTimeout: await aDaiCollateral.oracleTimeout(),
          targetName: await aDaiCollateral.targetName(),
          defaultThreshold,
          delayUntilDefault: await aDaiCollateral.delayUntilDefault(),
        },
        REVENUE_HIDING
      )

      // Check initial state
      expect(await newADaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newADaiCollateral.whenDefault()).to.equal(MAX_UINT48)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newADaiCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newADaiCollateral.refresh())
        .to.emit(newADaiCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newADaiCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newADaiCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newADaiCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newADaiCollateral.whenDefault()
      await expect(newADaiCollateral.refresh()).to.not.emit(
        newADaiCollateral,
        'CollateralStatusChanged'
      )
      expect(await newADaiCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newADaiCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const sATokenMockFactory: ContractFactory = await ethers.getContractFactory(
        'StaticATokenMock'
      )
      const aDaiErc20 = await ethers.getContractAt('ERC20Mock', aDai.address)
      const symbol = await aDaiErc20.symbol()
      const saDaiMock: StaticATokenMock = <StaticATokenMock>(
        await sATokenMockFactory.deploy(symbol + ' Token', symbol, dai.address)
      )
      // Set initial exchange rate to the new aDai Mock
      await saDaiMock.setExchangeRate(fp('0.02'))

      // Redeploy plugin using the new aDai mock
      const newADaiCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
        await ethers.getContractFactory('ATokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await aDaiCollateral.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: saDaiMock.address,
          maxTradeVolume: await aDaiCollateral.maxTradeVolume(),
          oracleTimeout: await aDaiCollateral.oracleTimeout(),
          targetName: await aDaiCollateral.targetName(),
          defaultThreshold,
          delayUntilDefault: await aDaiCollateral.delayUntilDefault(),
        },
        REVENUE_HIDING
      )
      await newADaiCollateral.refresh()

      // Check initial state
      expect(await newADaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newADaiCollateral.whenDefault()).to.equal(MAX_UINT48)

      // Decrease rate for aDAI, will disable collateral immediately
      await saDaiMock.setExchangeRate(fp('0.019'))

      // Force updates - Should update whenDefault and status for Atokens/aTokens
      await expect(newADaiCollateral.refresh())
        .to.emit(newADaiCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newADaiCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newADaiCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
        await ATokenFiatCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: invalidChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: await aDaiCollateral.erc20(),
            maxTradeVolume: await aDaiCollateral.maxTradeVolume(),
            oracleTimeout: await aDaiCollateral.oracleTimeout(),
            targetName: await aDaiCollateral.targetName(),
            defaultThreshold,
            delayUntilDefault: await aDaiCollateral.delayUntilDefault(),
          },
          REVENUE_HIDING
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCTokenCollateral.refresh()).to.be.reverted
      expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCTokenCollateral.refresh()).to.be.reverted
      expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  describeGas('Gas Reporting', () => {
    context('refresh()', () => {
      beforeEach(async () => {
        await aDaiCollateral.refresh()
        expect(await aDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      })

      it('during SOUND', async () => {
        await snapshotGasCost(aDaiCollateral.refresh())
        await snapshotGasCost(aDaiCollateral.refresh()) // 2nd refresh can be different than 1st
      })

      it('during soft default', async () => {
        // Redeploy plugin using a Chainlink mock feed where we can change the price
        const newADaiCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
          await ethers.getContractFactory('ATokenFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: mockChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: await aDaiCollateral.erc20(),
            maxTradeVolume: await aDaiCollateral.maxTradeVolume(),
            oracleTimeout: await aDaiCollateral.oracleTimeout(),
            targetName: await aDaiCollateral.targetName(),
            defaultThreshold,
            delayUntilDefault: await aDaiCollateral.delayUntilDefault(),
          },
          REVENUE_HIDING
        )

        // Check initial state
        expect(await newADaiCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await newADaiCollateral.whenDefault()).to.equal(MAX_UINT48)

        // Depeg one of the underlying tokens - Reducing price 20%
        await setOraclePrice(newADaiCollateral.address, bn('8e7')) // -20%
        await snapshotGasCost(newADaiCollateral.refresh())
        await snapshotGasCost(newADaiCollateral.refresh()) // 2nd refresh can be different than 1st
      })

      it('after soft default', async () => {
        // Redeploy plugin using a Chainlink mock feed where we can change the price
        const newADaiCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
          await ethers.getContractFactory('ATokenFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: mockChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: await aDaiCollateral.erc20(),
            maxTradeVolume: await aDaiCollateral.maxTradeVolume(),
            oracleTimeout: await aDaiCollateral.oracleTimeout(),
            targetName: await aDaiCollateral.targetName(),
            defaultThreshold,
            delayUntilDefault: await aDaiCollateral.delayUntilDefault(),
          },
          REVENUE_HIDING
        )

        // Check initial state
        expect(await newADaiCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await newADaiCollateral.whenDefault()).to.equal(MAX_UINT48)

        // Depeg one of the underlying tokens - Reducing price 20%
        await setOraclePrice(newADaiCollateral.address, bn('8e7')) // -20%

        // Force updates - Should update whenDefault and status
        await expect(newADaiCollateral.refresh())
          .to.emit(newADaiCollateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
        expect(await newADaiCollateral.status()).to.equal(CollateralStatus.IFFY)

        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
          delayUntilDefault
        )
        expect(await newADaiCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

        // Move time forward past delayUntilDefault
        await advanceTime(Number(delayUntilDefault))
        expect(await newADaiCollateral.status()).to.equal(CollateralStatus.DISABLED)

        // Nothing changes if attempt to refresh after default
        // CToken
        const prevWhenDefault: BigNumber = await newADaiCollateral.whenDefault()
        await expect(newADaiCollateral.refresh()).to.not.emit(
          newADaiCollateral,
          'CollateralStatusChanged'
        )
        expect(await newADaiCollateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await newADaiCollateral.whenDefault()).to.equal(prevWhenDefault)
        await snapshotGasCost(newADaiCollateral.refresh())
        await snapshotGasCost(newADaiCollateral.refresh()) // 2nd refresh can be different than 1st
      })

      it('after oracle timeout', async () => {
        const oracleTimeout = await aDaiCollateral.oracleTimeout()
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
        await advanceBlocks(bn(oracleTimeout).div(12))
        await snapshotGasCost(aDaiCollateral.refresh())
        await snapshotGasCost(aDaiCollateral.refresh()) // 2nd refresh can be different than 1st
      })

      it('after full price timeout', async () => {
        await advanceTime(
          (await aDaiCollateral.priceTimeout()) + (await aDaiCollateral.oracleTimeout())
        )
        const p = await aDaiCollateral.price()
        expect(p[0]).to.equal(0)
        expect(p[1]).to.equal(MAX_UINT192)
        await snapshotGasCost(aDaiCollateral.refresh())
        await snapshotGasCost(aDaiCollateral.refresh()) // 2nd refresh can be different than 1st
      })

      it('after hard default', async () => {
        const sATokenMockFactory: ContractFactory = await ethers.getContractFactory(
          'StaticATokenMock'
        )
        const aDaiErc20 = await ethers.getContractAt('ERC20Mock', aDai.address)
        const symbol = await aDaiErc20.symbol()
        const saDaiMock: StaticATokenMock = <StaticATokenMock>(
          await sATokenMockFactory.deploy(symbol + ' Token', symbol, dai.address)
        )
        // Set initial exchange rate to the new aDai Mock
        await saDaiMock.setExchangeRate(fp('0.02'))

        // Redeploy plugin using the new aDai mock
        const newADaiCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
          await ethers.getContractFactory('ATokenFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: await aDaiCollateral.chainlinkFeed(),
            oracleError: ORACLE_ERROR,
            erc20: saDaiMock.address,
            maxTradeVolume: await aDaiCollateral.maxTradeVolume(),
            oracleTimeout: await aDaiCollateral.oracleTimeout(),
            targetName: await aDaiCollateral.targetName(),
            defaultThreshold,
            delayUntilDefault: await aDaiCollateral.delayUntilDefault(),
          },
          REVENUE_HIDING
        )
        await newADaiCollateral.refresh()

        // Decrease rate for aDAI, will disable collateral immediately
        await saDaiMock.setExchangeRate(fp('0.019'))
        await snapshotGasCost(newADaiCollateral.refresh())
        await snapshotGasCost(newADaiCollateral.refresh()) // 2nd refresh can be different than 1st
      })
    })

    context('ERC20 Wrapper', () => {
      it('transfer', async () => {
        await snapshotGasCost(staticAToken.connect(addr1).transfer(aDaiCollateral.address, bn('1')))
        await snapshotGasCost(staticAToken.connect(addr1).transfer(aDaiCollateral.address, bn('1')))
      })
    })
  })
})
