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
import { bn, fp } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import { setOraclePrice } from '../../utils/oracles'
import {
  Asset,
  CBETHCollateral,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  Icbeth,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  OracleLib,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '../../../typechain'
import forkBlockNumber from '../fork-block-numbers'
import { useEnv } from '#/utils/env'

// Setup test environment
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

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const erateOracle = '0x9b37180d847B27ADC13C2277299045C1237Ae281'
const holderCBETH = '0xFA11D91e74fdD98F79E01582B9664143E1036931'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`CBETHCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let cbeth: Icbeth
  let cbethCollateral: CBETHCollateral
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

  const defaultRelativeThreshold = fp('0.85') // 85%
  const delayUntilDefault = bn('86400') // 24h
  // values at block 14916729
  const initialCBETHRate = fp('1.018056973225187234')
  const initialCBETH_ETHOracle = fp('0.961218431')
  const initialEthPrice = fp('1232.64')
  const initialCBETHPrice = initialCBETH_ETHOracle.mul(initialEthPrice).div(fp('1'))

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let cbethCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    await setup(forkBlockNumber['cbeth-oracle'])
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  after(async () => {
    await setup(forkBlockNumber['default'])
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // Get cbeth contract
    cbeth = <Icbeth>await ethers.getContractAt('Icbeth', networkConfig[chainId].tokens.CBETH || '')

    // Deploy CBETH collateral plugin
    cbethCollateralFactory = await ethers.getContractFactory('CBETHCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    cbethCollateral = <CBETHCollateral>(
      await cbethCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        networkConfig[chainId].chainlinkFeeds.CBETH as string,
        cbeth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultRelativeThreshold,
        delayUntilDefault
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // cbeth
    initialBal = fp('5000')
    await whileImpersonating(holderCBETH, async (cbethSigner) => {
      await cbeth.connect(cbethSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [cbethCollateral.address],
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
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, fp('1232.64'))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Collateral plugin
      // cbeth (CBETHCollateral)
      expect(await cbethCollateral.isCollateral()).to.equal(true)
      expect(await cbethCollateral.erc20()).to.equal(cbeth.address)
      expect(await cbethCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ETH'))
      expect(await cbethCollateral.refPerTok()).to.be.closeTo(initialCBETHRate, bn('10'))
      expect(await cbethCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await cbethCollateral.pricePerTarget()).to.be.closeTo(initialEthPrice, fp('1'))
      expect(await cbethCollateral.prevReferencePrice()).to.equal(await cbethCollateral.refPerTok())
      expect(await cbethCollateral.strictPrice()).to.be.closeTo(initialCBETHPrice, fp('1'))
      expect(await cbethCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(cbeth.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(cbethCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(cbethCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(cbeth.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(initialCBETHPrice.mul(fp('1')).div(initialCBETHRate), fp('0.01'))

      // Check RToken price
      const issueAmount: BigNumber = initialBal.div(initialEthPrice)
      await cbeth.connect(addr1).approve(rToken.address, issueAmount.mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(
        initialCBETHPrice.mul(fp('1')).div(initialCBETHRate),
        fp('0.01')
      )
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    // Issuance and redemption, making the collateral appreciate over time
    it('modifying refPerTok', async () => {
      const issueAmount: BigNumber = fp('1000')

      // Provide approvals for issuances
      await cbeth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      const preBalanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Check rate
      const cbethRefPerTok1: BigNumber = await cbethCollateral.refPerTok() // 1.0180569732251872
      expect(cbethRefPerTok1).to.be.closeTo(initialCBETHRate, fp('0.0001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(
        issueAmount.mul(initialCBETHPrice.mul(fp('1')).div(initialCBETHRate)).div(bn('1e18')),
        fp('10')
      )

      const erate: BigNumber = await cbeth.exchangeRate()
      const higherErate: BigNumber = erate.add(fp('0.01'))

      // An oracle contract can update the exchange rate in cbETH. By impersonating that oracle we can directly update
      // the exchange rate while using real cbeth contracts instead of resorting to mocks
      await whileImpersonating(erateOracle, async (cbethSigner) => {
        await cbeth.connect(cbethSigner).updateExchangeRate(higherErate)
      })

      await cbethCollateral.refresh()
      expect(await cbethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rate Has changed, slight increase
      const cbethRefPerTok2: BigNumber = await cbethCollateral.refPerTok() // 1.0280569732251872

      // Check rate increase
      expect(cbethRefPerTok2).to.be.gt(cbethRefPerTok1)

      // Still close to the original value
      expect(cbethRefPerTok2).to.be.closeTo(cbethRefPerTok1, fp('0.02'))

      // increase cbeth to eth exchange rate significantly
      const highestErate: BigNumber = erate.add(fp('0.1'))
      await whileImpersonating(erateOracle, async (cbethSigner) => {
        await cbeth.connect(cbethSigner).updateExchangeRate(highestErate)
      })

      await cbethCollateral.refresh()
      expect(await cbethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rate changed significantly
      const cbethRefPerTok3: BigNumber = await cbethCollateral.refPerTok() // 1.1180569732251873

      // Check rate
      expect(cbethRefPerTok3).to.be.gt(cbethRefPerTok2)

      // Need to adjust ranges
      expect(cbethRefPerTok3).to.be.closeTo(fp('1.1180569'), fp('0.001'))

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - less cbeth should have been sent to the user
      const newBalanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Check received tokens represent same value deposited
      const input = preBalanceAddr1cbeth.sub(balanceAddr1cbeth)
      const valueIncrease = cbethRefPerTok3.mul(bn('1e18')).div(cbethRefPerTok1)
      const fairOut = input.mul(bn('1e18')).div(valueIncrease)
      expect(newBalanceAddr1cbeth.sub(balanceAddr1cbeth)).to.be.closeTo(fairOut, bn('8e7'))

      // Check remainders in Backing Manager
      expect(await cbeth.balanceOf(backingManager.address)).to.be.closeTo(
        input.sub(fairOut),
        bn('5e7')
      )
    })

    it('modifying eth/usd oracle', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const newCBETHCollateral: CBETHCollateral = <CBETHCollateral>await (
        await ethers.getContractFactory('CBETHCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        networkConfig[chainId].chainlinkFeeds.CBETH as string,
        await cbethCollateral.erc20(),
        await cbethCollateral.maxTradeVolume(),
        await cbethCollateral.oracleTimeout(),
        await cbethCollateral.targetName(),
        await cbethCollateral.defaultRelativeThreshold(),
        await cbethCollateral.delayUntilDefault()
      )

      // After creating the new collateral with mocked oracle we use it in the facade so we can test totalAssetValue
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
        primaryBasket: [newCBETHCollateral.address],
        weights: [fp('1')],
        backups: [],
        beneficiaries: [],
      }

      // Deploy RToken via FacadeWrite
      const receipt = await (
        await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
      ).wait()

      // Get Main
      const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args
        .main
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

      // Check initial state
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newCBETHCollateral.whenDefault()).to.equal(MAX_UINT256)

      const issueAmount: BigNumber = fp('1000')

      // Provide approvals for issuances
      await cbeth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      const preBalanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Check rates and prices
      const cbethPrice1: BigNumber = await newCBETHCollateral.strictPrice() // 1184.8362867510891
      const cbethRefPerTok1: BigNumber = await newCBETHCollateral.refPerTok() // 1.0180569732251872

      expect(cbethPrice1).to.be.closeTo(initialCBETHPrice, fp('1'))
      expect(cbethRefPerTok1).to.be.closeTo(initialCBETHRate, fp('0.0001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(
        issueAmount.mul(initialCBETHPrice.mul(fp('1')).div(initialCBETHRate)).div(bn('1e18')),
        fp('10')
      )

      // increase eth/usd oracle price
      await setOraclePrice(newCBETHCollateral.address, fp('1244.9664')) // +1%

      await newCBETHCollateral.refresh()
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const cbethPrice2: BigNumber = await newCBETHCollateral.strictPrice() // 1196.6846496186001
      const cbethRefPerTok2: BigNumber = await newCBETHCollateral.refPerTok() // 1.0180569732251872

      // Check rates and price increase
      expect(cbethPrice2).to.be.gt(cbethPrice1)
      expect(cbethRefPerTok2).to.be.eq(cbethRefPerTok1)

      // Still close to the original values
      expect(cbethPrice2).to.be.closeTo(cbethPrice1, fp('21'))
      expect(cbethRefPerTok2).to.be.closeTo(cbethRefPerTok1, fp('0.02'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // increase eth/usd oracle price significantly
      await setOraclePrice(newCBETHCollateral.address, fp('1355.9040000000002')) // +10%

      await newCBETHCollateral.refresh()
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const cbethPrice3: BigNumber = await newCBETHCollateral.strictPrice() // 1303.3199154261983
      const cbethRefPerTok3: BigNumber = await newCBETHCollateral.refPerTok() // 1.0180569732251872

      // Check rates and price increase
      expect(cbethPrice3).to.be.gt(cbethPrice2)
      expect(cbethRefPerTok3).to.be.eq(cbethRefPerTok2)

      // Need to adjust ranges
      expect(cbethPrice3).to.be.closeTo(fp('1303.3199'), fp('0.001'))

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

      // Check balances - less cbeth should have been sent to the user
      const newBalanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Check received tokens represent same value deposited
      const input = preBalanceAddr1cbeth.sub(balanceAddr1cbeth)
      const valueIncrease = cbethRefPerTok3.mul(bn('1e18')).div(cbethRefPerTok1)
      const fairOut = input.mul(bn('1e18')).div(valueIncrease)
      expect(newBalanceAddr1cbeth.sub(balanceAddr1cbeth)).to.be.closeTo(fairOut, bn('8e7'))

      // Check remainders in Backing Manager
      expect(await cbeth.balanceOf(backingManager.address)).to.be.closeTo(
        input.sub(fairOut),
        bn('5e7')
      )

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        input.sub(fairOut).mul(cbethRefPerTok3).mul(initialEthPrice).div(bn('1e36')),
        fp('0.5')
      )
    })

    it('modifying eth/cbeth oracle', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const newCBETHCollateral: CBETHCollateral = <CBETHCollateral>await (
        await ethers.getContractFactory('CBETHCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        mockChainlinkFeed.address,
        await cbethCollateral.erc20(),
        await cbethCollateral.maxTradeVolume(),
        await cbethCollateral.oracleTimeout(),
        await cbethCollateral.targetName(),
        await cbethCollateral.defaultRelativeThreshold(),
        await cbethCollateral.delayUntilDefault()
      )

      // After creating the new collateral with mocked oracle we use it in the facade so we can test totalAssetValue
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
        primaryBasket: [newCBETHCollateral.address],
        weights: [fp('1')],
        backups: [],
        beneficiaries: [],
      }

      // Deploy RToken via FacadeWrite
      const receipt = await (
        await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
      ).wait()

      // Get Main
      const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args
        .main
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

      await mockChainlinkFeed.updateAnswer(fp('0.961218431'))

      // Check initial state
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newCBETHCollateral.whenDefault()).to.equal(MAX_UINT256)

      const issueAmount: BigNumber = fp('1000')

      // Provide approvals for issuances
      await cbeth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      const preBalanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Check rates and prices
      const cbethPrice1: BigNumber = await newCBETHCollateral.strictPrice() // 1184.8398083941934
      const cbethRefPerTok1: BigNumber = await newCBETHCollateral.refPerTok() // 1.0180569732251872

      expect(cbethPrice1).to.be.closeTo(initialCBETHPrice, fp('1'))
      expect(cbethRefPerTok1).to.be.closeTo(initialCBETHRate, fp('0.0001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(
        issueAmount.mul(initialCBETHPrice.mul(fp('1')).div(initialCBETHRate)).div(bn('1e18')),
        fp('10')
      )

      // increase eth/usd oracle price
      await mockChainlinkFeed.updateAnswer(fp('0.97083061531')) // +1%

      await newCBETHCollateral.refresh()
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const cbethPrice2: BigNumber = await newCBETHCollateral.strictPrice() // 1196.6882064781355
      const cbethRefPerTok2: BigNumber = await newCBETHCollateral.refPerTok() // 1.0180569732251872

      // Check rates and price increase
      expect(cbethPrice2).to.be.gt(cbethPrice1)
      expect(cbethRefPerTok2).to.be.eq(cbethRefPerTok1)

      // Still close to the original values
      expect(cbethPrice2).to.be.closeTo(cbethPrice1, fp('21'))
      expect(cbethRefPerTok2).to.be.closeTo(cbethRefPerTok1, fp('0.02'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // increase eth/usd oracle price significantly
      await mockChainlinkFeed.updateAnswer(fp('1.0573402741000002')) // +10%

      await newCBETHCollateral.refresh()
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const cbethPrice3: BigNumber = await newCBETHCollateral.strictPrice() // 1303.323789233613
      const cbethRefPerTok3: BigNumber = await newCBETHCollateral.refPerTok() // 1.0180569732251872

      // Check rates and price increase
      expect(cbethPrice3).to.be.gt(cbethPrice2)
      expect(cbethRefPerTok3).to.be.eq(cbethRefPerTok2)

      // Need to adjust ranges
      expect(cbethPrice3).to.be.closeTo(fp('1303.3199'), fp('0.01'))

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

      // Check balances - less cbeth should have been sent to the user
      const newBalanceAddr1cbeth: BigNumber = await cbeth.balanceOf(addr1.address)

      // Check received tokens represent same value deposited
      const input = preBalanceAddr1cbeth.sub(balanceAddr1cbeth)
      const valueIncrease = cbethRefPerTok3.mul(bn('1e18')).div(cbethRefPerTok1)
      const fairOut = input.mul(bn('1e18')).div(valueIncrease)
      expect(newBalanceAddr1cbeth.sub(balanceAddr1cbeth)).to.be.closeTo(fairOut, bn('8e7'))

      // Check remainders in Backing Manager
      expect(await cbeth.balanceOf(backingManager.address)).to.be.closeTo(
        input.sub(fairOut),
        bn('5e7')
      )

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        input.sub(fairOut).mul(cbethRefPerTok3).mul(initialEthPrice).div(bn('1e36')),
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const issueAmount: BigNumber = fp('1000')

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: ['0x' + '00'.repeat(20), 0],
          emitted: true,
        },
      ])

      // Provide approvals for issuances
      await cbeth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      await expect(cbethCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await cbethCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await cbethCollateral.refresh()
      expect(await cbethCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Remaining iffy long enough should tranasition state to disabled
      await advanceTime(delayUntilDefault.add(bn('1')).toString())
      await cbethCollateral.refresh()
      expect(await cbethCollateral.status()).to.equal(CollateralStatus.DISABLED)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  describe('Collateral Status', () => {
    it('Updates status in case of soft default', async () => {
      // Redeploy plugin using a Chainlink mock eth/cbeth feed where we can change the price
      const newCBETHCollateral: CBETHCollateral = <CBETHCollateral>await (
        await ethers.getContractFactory('CBETHCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        mockChainlinkFeed.address,
        await cbethCollateral.erc20(),
        await cbethCollateral.maxTradeVolume(),
        await cbethCollateral.oracleTimeout(),
        await cbethCollateral.targetName(),
        await cbethCollateral.defaultRelativeThreshold(),
        await cbethCollateral.delayUntilDefault()
      )

      await mockChainlinkFeed.updateAnswer(fp('0.961218431'))

      // Check initial state
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newCBETHCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Simulate market price of cbeth dropping to 70% of eth
      await mockChainlinkFeed.updateAnswer(fp('0.7'))

      // Force updates - Should update whenDefault and status
      await expect(newCBETHCollateral.refresh())
        .to.emit(newCBETHCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newCBETHCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      const prevWhenDefault: BigNumber = await newCBETHCollateral.whenDefault()
      await expect(newCBETHCollateral.refresh()).to.not.emit(
        newCBETHCollateral,
        'CollateralStatusChanged'
      )
      expect(await newCBETHCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newCBETHCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Check initial state
      await cbethCollateral.refresh()
      expect(await cbethCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cbethCollateral.whenDefault()).to.equal(MAX_UINT256)

      // decrease cbeth to eth exchange rate so refPerTok decreases
      const erate: BigNumber = await cbeth.exchangeRate()
      const lowerErate: BigNumber = erate.sub(fp('0.1'))
      await whileImpersonating(erateOracle, async (cbethSigner) => {
        await cbeth.connect(cbethSigner).updateExchangeRate(lowerErate)
      })

      // Force updates
      await expect(cbethCollateral.refresh())
        .to.emit(cbethCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await cbethCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await cbethCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if eth/usd oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1000e8'))
      )

      const invalidCBETHCollateral: CBETHCollateral = <CBETHCollateral>(
        await cbethCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await cbethCollateral.ETH_CBETHChainlinkFeed(),
          await cbethCollateral.erc20(),
          await cbethCollateral.maxTradeVolume(),
          await cbethCollateral.oracleTimeout(),
          await cbethCollateral.targetName(),
          await cbethCollateral.defaultRelativeThreshold(),
          await cbethCollateral.delayUntilDefault()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCBETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCBETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('Reverts if eth cbeth/eth oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1000e8'))
      )

      const invalidCBETHCollateral: CBETHCollateral = <CBETHCollateral>(
        await cbethCollateralFactory.deploy(
          fp('1'),
          await cbethCollateral.USD_ETHChainlinkFeed(),
          invalidChainlinkFeed.address,
          await cbethCollateral.erc20(),
          await cbethCollateral.maxTradeVolume(),
          await cbethCollateral.oracleTimeout(),
          await cbethCollateral.targetName(),
          await cbethCollateral.defaultRelativeThreshold(),
          await cbethCollateral.delayUntilDefault()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCBETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCBETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCBETHCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})
