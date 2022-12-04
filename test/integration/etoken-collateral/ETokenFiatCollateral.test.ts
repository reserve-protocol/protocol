import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from './fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import {
  IGovParams,
  IRTokenSetup,
  networkConfig,
} from '../../../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals, ZERO } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice1 } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  ETokenFiatCollateral,
  ETokenMock,
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
} from '../../../typechain'
import { 
  ITestParams, 
  eTokenHolders, 
  targetName, 
  etokenRefPerTok, 
  delta, 
  issueAmount, 
  tokenOneUnit, 
  fallBackPrice,
  config,
  rTokenConfig,
  BN1,
  FP1
} from './test-params'

const createFixtureLoader = waffle.createFixtureLoader
const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`ETokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {

  let params: ITestParams

  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let token: ERC20Mock
  let eToken: ETokenMock
  let eTokenCollateral: ETokenFiatCollateral
  let eulToken: ERC20Mock
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

  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet
  let chainId: number
  
  let ETokenCollateralFactory: ContractFactory
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

    // ---  Testing Params ---- //
    // Define which FiatCollateral, such as DAI, USDC, USDT is used for this test file. 

    params = {
        // Token Addresses
        eulAddr: networkConfig[chainId].tokens.EUL,
        tokenAddr: networkConfig[chainId].tokens.DAI,
        etokenAddr: networkConfig[chainId].tokens.eDAI,
        // ChainlinkFeed
        tokenChainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI,
        refUnitChainlinkFeed: ZERO_ADDRESS,
        targetChainlinkFeed: ZERO_ADDRESS,
        // Holder address in Mainnet
        etokenHolderAddr: eTokenHolders.edai,
        // Target
        targetName: targetName.usd,
        // Numbers: 
        refPerTok: etokenRefPerTok.edai, // DAI/eDAI = 1.015, USDC/eUSDC = 1.018, USDT/eUSDT = 1.018
        refPerTok1: etokenRefPerTok.edai1, // DAI/eDAI = 1.065, USDC/eUSDC = 1.097, USDT/eUSDT = 1.018
        delta: delta.usd, // apx 0.1 cent$
        issueAmount: issueAmount.usd, // 10000e18 for DAI, 10000e6 for USDC&USDT
        oneUnit: tokenOneUnit.erc18, // DAI = 1e18, USDC and USDT = 1e6
        fallBackPrice: fallBackPrice.usd
      }
    
    // ------- // 

    // Get required contracts for eDAI
    // EUL token
    eulToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', params.eulAddr || '')
    )
    // DAI token
    token = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', params.tokenAddr || '')
    )
    // eToken token
    eToken = <ETokenMock>(
      await ethers.getContractAt('ETokenMock', params.etokenAddr || '')
    )

    // Deploy eToken collateral plugin
    ETokenCollateralFactory = await ethers.getContractFactory('ETokenFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    eTokenCollateral = <ETokenFiatCollateral>(
      await ETokenCollateralFactory.deploy(
        params.fallBackPrice, // {UoA}
        params.tokenChainlinkFeed as string,
        params.etokenAddr as string,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        params.targetName,
        defaultThreshold,
        delayUntilDefault,
        (await token.decimals()).toString()
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // eToken
    await whileImpersonating(params.etokenHolderAddr, async (etokenSigner) => {
      await eToken.connect(etokenSigner).transfer(addr1.address, toBNDecimals(params.issueAmount, 18))
    })

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [],
      primaryBasket: [eTokenCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries: []
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
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(await token.decimals(), params.oneUnit)
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {

      expect(await eulToken.decimals()).to.equal(18)
      expect(await eToken.decimals()).to.equal(18)

      // Check Collateral plugin
      // eToken (ETokenFiatCollateral)
      const strictPrice:BigNumber = await eTokenCollateral.strictPrice()
      const refPerTok:BigNumber = await eTokenCollateral.refPerTok()

      expect(await eTokenCollateral.fallbackPrice()).to.equal(params.fallBackPrice)
      expect(await eTokenCollateral.chainlinkFeed()).to.equal(params.tokenChainlinkFeed as string)
      expect(await eTokenCollateral.erc20()).to.equal(params.etokenAddr as string)
      expect(await eTokenCollateral.targetName()).to.equal(params.targetName)

      expect(await eTokenCollateral.isCollateral()).to.equal(true)
      expect(await eTokenCollateral.referenceERC20Decimals()).to.equal(await token.decimals())
      expect(await eTokenCollateral.targetPerRef()).to.equal(FP1)
      expect(await eTokenCollateral.prevReferencePrice()).to.be.closeTo(params.refPerTok, params.delta)

      expect(strictPrice).to.be.closeTo(params.refPerTok.mul(params.fallBackPrice).div(BN1), params.delta)
      expect(refPerTok).to.be.closeTo(params.refPerTok, params.delta)

      // Check claim data
      await expect(eTokenCollateral.claimRewards())
        .to.emit(eTokenCollateral, 'RewardsClaimed')
        .withArgs(ZERO_ADDRESS, 0)
      expect(await eTokenCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)

      console.log(
        '\n',
        '- Collateral Price: ', strictPrice.toString(), '\n',
        '- refPerTok: ', refPerTok.toString(), '\n',
        '\n',
        )
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(params.etokenAddr as string)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(eTokenCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(eTokenCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(params.etokenAddr as string)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(ZERO)
      expect(await basketHandler.timestamp()).to.be.gt(ZERO)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(ZERO)
      const [isFallback, price1] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price1).to.be.closeTo(params.fallBackPrice, params.delta)

      // Check RToken price
      await eToken.connect(addr1).approve(rToken.address, toBNDecimals(params.issueAmount, 18).mul(100))
      await expect(rToken.connect(addr1).issue(params.issueAmount)).to.emit(rToken, 'Issuance')

      const price2:BigNumber = await rTokenAsset.strictPrice()
      expect(price2).to.be.closeTo(params.fallBackPrice, params.delta)

      const balanceAddr1: BigNumber = await eToken.balanceOf(addr1.address)
      const balanceBackingManager: BigNumber = await eToken.balanceOf(backingManager.address)

            // make sure that the smaller unit of eToken is held in backingManager after the issuance of RTokens
      await expect(params.issueAmount).to.be.gt(balanceBackingManager)

      const price3 :BigNumber = await eTokenCollateral.strictPrice()

      console.log(
        '\n',
        '- RToken Price(basketHandler): ', price1.toString(), '\n',
        '- RToken Price(rTokenAsset): ', price2.toString(), '\n',
        '- usdColl Balance Addr1: ', balanceAddr1.toString(), '\n',
        '- usdColl Balance BackingManager: ', balanceBackingManager.toString(), '\n',
        '- Collateral strictPrice(eTokenCollateral): ', price3.toString(), '\n',
        '\n',
      )
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        ETokenCollateralFactory.deploy(
          params.fallBackPrice,
          params.tokenChainlinkFeed as string,
          params.etokenAddr as string,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          params.targetName,
          ZERO,
          delayUntilDefault,
          (await token.decimals()).toString()
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ReferemceERC20Decimals
      await expect(
        ETokenCollateralFactory.deploy(
          params.fallBackPrice,
          params.tokenChainlinkFeed as string,
          params.etokenAddr as string,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          params.targetName,
          defaultThreshold,
          delayUntilDefault,
          0
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {

      // Store Balances after issuance
      const balanceAddr1eToken1: BigNumber = await eToken.balanceOf(addr1.address)
      const rate1: BigNumber = await eToken.convertBalanceToUnderlying(BN1)

      // Provide approvals for issuances
      await eToken.connect(addr1).approve(rToken.address, toBNDecimals(params.issueAmount, 18).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(params.issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(params.issueAmount)

      // Check rates and prices
      const eTokenPrice1: BigNumber = await eTokenCollateral.strictPrice() 
      const eTokenRefPerTok1: BigNumber = await eTokenCollateral.refPerTok() 

      const strictPrice: BigNumber = params.fallBackPrice.mul(params.refPerTok).div(BN1)

      expect(eTokenPrice1).to.be.closeTo(strictPrice, params.delta)
      expect(eTokenRefPerTok1).to.be.closeTo(params.refPerTok, params.delta)

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )

      const estimatedValue1: BigNumber = params.issueAmount.div(BN1).mul(params.fallBackPrice)
      expect(totalAssetValue1).to.be.closeTo(estimatedValue1, (params.delta.mul(estimatedValue1).div(BN1))) // apx 1% delta

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await eTokenCollateral.refresh()
      expect(await eTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const eTokenPrice2: BigNumber = await eTokenCollateral.strictPrice() // ~1016
      const eTokenRefPerTok2: BigNumber = await eTokenCollateral.refPerTok() // ~1016

      // Check rates and price increase
      expect(eTokenPrice2).to.be.gt(eTokenPrice1)
      expect(eTokenRefPerTok2).to.be.gt(eTokenRefPerTok1)

      // Still close to the original values
      expect(eTokenPrice2).to.be.closeTo(strictPrice, params.delta)
      expect(eTokenRefPerTok2).to.be.closeTo(params.refPerTok, params.delta)

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks significantly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await eTokenCollateral.refresh()
      expect(await eTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const eTokenPrice3: BigNumber = await eTokenCollateral.strictPrice() 
      const eTokenRefPerTok3: BigNumber = await eTokenCollateral.refPerTok() 

      // Check rates and price increase
      expect(eTokenPrice3).to.be.gt(eTokenPrice2)
      expect(eTokenRefPerTok3).to.be.gt(eTokenRefPerTok2)

      const strictPrice2: BigNumber = params.fallBackPrice.mul(params.refPerTok1).div(BN1)

      // Need to adjust ranges
      expect(eTokenPrice3).to.be.closeTo(strictPrice2, params.delta)
      expect(eTokenRefPerTok3).to.be.closeTo(params.refPerTok1, params.delta)

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(params.issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(ZERO)
      expect(await rToken.totalSupply()).to.equal(ZERO)

      // Check balances - Fewer eTokens should have been sent to the user
      const balanceAddr1eToken2: BigNumber = await eToken.balanceOf(addr1.address)
      expect(balanceAddr1eToken2).to.be.lt(balanceAddr1eToken1)

      // Check new etoken balance is worth than previous balance
      const BeforeBalanceValue: BigNumber = (rate1).mul(balanceAddr1eToken1).div(params.oneUnit)
      const AfterBalanceValue: BigNumber = (await eToken.convertBalanceToUnderlying(BN1)).mul(balanceAddr1eToken2).div(params.oneUnit)
      expect(AfterBalanceValue).to.be.gt(BeforeBalanceValue)

      // Check remainders in Backing Manager
      const BMETokenBalance:BigNumber = await eToken.balanceOf(backingManager.address)
      expect(BMETokenBalance).to.be.gt(ZERO) 

      //  Check total asset value (remainder)
      const RTokenTotalValue: BigNumber = await facadeTest.callStatic.totalAssetValue(rToken.address)
      expect(RTokenTotalValue).to.be.gt(ZERO)

      console.log(
        '\n',
        '- EToken Balance 1: ', balanceAddr1eToken1.toString(), '\n',
        '- eTokenRefPerTok1: ', eTokenRefPerTok1.toString(), '\n',
        '- eTokenPrice1: ', eTokenPrice1.toString(), '\n',
        '- totalAssetValue1: ', totalAssetValue1.toString(), '\n',
        '\n',
        '- EToken Balance 2: ', balanceAddr1eToken2.toString(), '\n',
        '- eTokenRefPerTok3: ', eTokenRefPerTok3.toString(), '\n',
        '- eTokenPrice3: ', eTokenPrice3.toString(), '\n',
        '- totalAssetValue3: ', totalAssetValue3.toString(), '\n',
        '\n',
        '- BeforeBalanceValue: ', BeforeBalanceValue.toString(), '\n',
        '- AfterBalanceValue: ', AfterBalanceValue.toString(), '\n',
        '- EToken Balance(Backing Manager): ', BMETokenBalance.toString(), '\n',
        '- RToken TotalValue: ', RTokenTotalValue.toString(), '\n',
        '\n',
        )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {

      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await eulToken.balanceOf(backingManager.address)).to.equal(ZERO)

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [ZERO_ADDRESS, bn(ZERO)],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await eulToken.balanceOf(backingManager.address)).to.equal(ZERO)

      // Provide approvals for issuances
      await eToken.connect(addr1).approve(rToken.address, toBNDecimals(params.issueAmount, 18).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(params.issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(params.issueAmount)

      // Now we can claim rewards - check initial balance still 0
      expect(await eulToken.balanceOf(backingManager.address)).to.equal(ZERO)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Check rewards in EUL
      const rewardsEUL1: BigNumber = await eulToken.balanceOf(backingManager.address)

      expect(rewardsEUL1).to.equal(ZERO)

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      const rewardsEUL2: BigNumber = await eulToken.balanceOf(backingManager.address)

      expect(rewardsEUL2.sub(rewardsEUL1)).to.equal(ZERO)

      console.log(
        '\n',
        '- rewardsEUL1: ', rewardsEUL1.toString(), '\n',
        '- rewardsEUL2: ', rewardsEUL2.toString(), '\n',
        '\n',
        )
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {

      const NO_PRICE_DATA_FEED = '0xAB256C9d6aAE9ee6118A1531d43751996541799D'
      const strictPrice: BigNumber = params.fallBackPrice.mul(params.refPerTok).div(BN1)

      // Non/Invalid Price FEED
      // 1: NO_PRICE_DATA_FEED for tokenChainlinkFeed:
      // 2: Invalid Feed for tokenChainlinkFeed

      // ETokens Collateral with no price
      const nonPriceEtokenCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>await (
        await ethers.getContractFactory('ETokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        params.fallBackPrice,
        NO_PRICE_DATA_FEED,
        params.etokenAddr as string,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        params.targetName,
        defaultThreshold,
        delayUntilDefault,
        await token.decimals()
      )

      // ETokens - Collateral with no price info should revert
      await expect(nonPriceEtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonPriceEtokenCollateral.refresh()).to.be.reverted
      const status1 = await nonPriceEtokenCollateral.status()
      expect(status1).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidPriceEtokenCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>await (
        await ethers.getContractFactory('ETokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        params.fallBackPrice,
        mockChainlinkFeed.address,
        params.etokenAddr as string,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        params.targetName,
        defaultThreshold,
        delayUntilDefault,
        await token.decimals()
      )

      await setOraclePrice1(mockChainlinkFeed.address, ZERO)

      // Reverts with zero price
      await expect(invalidPriceEtokenCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidPriceEtokenCollateral.refresh()
      const status2 = await invalidPriceEtokenCollateral.status()
      expect(status2).to.equal(CollateralStatus.IFFY)

      // ORACLE_TIMEOUT
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Euler
      await expect(eTokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await eTokenCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(params.fallBackPrice)

      // Refresh should mark status IFFY
      await eTokenCollateral.refresh()
      const status3 = await eTokenCollateral.status()
      expect(status3).to.equal(CollateralStatus.IFFY)

      console.log(
        '\n',
        '- status1 (No ReferencePrice): ', status1, '\n',
        '- status2 (Invalid ReferencePrice): ', status2, '\n',
        '- status3 (eTokenCollateral): ', status3, '\n',
        '- price : ', price.toString(), '\n',
        '\n',
        )

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
      const neweTokenCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>await (
        await ethers.getContractFactory('ETokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        params.fallBackPrice,
        mockChainlinkFeed.address,
        await eTokenCollateral.erc20(),
        await eTokenCollateral.maxTradeVolume(),
        await eTokenCollateral.oracleTimeout(),
        await eTokenCollateral.targetName(),
        await eTokenCollateral.defaultThreshold(),
        await eTokenCollateral.delayUntilDefault(),
        await token.decimals()
      )

      // Check initial state
      expect(await neweTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await neweTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 6%. defaultThreshold = 5%
      await setOraclePrice1(mockChainlinkFeed.address, bn('0.94').mul(params.oneUnit)) // -6%

      // Force updates - Should update whenDefault and status
      await expect(neweTokenCollateral.refresh())
        .to.emit(neweTokenCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await neweTokenCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await neweTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await neweTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // EToken
      const prevWhenDefault: BigNumber = await neweTokenCollateral.whenDefault()
      await expect(neweTokenCollateral.refresh()).to.not.emit(
        neweTokenCollateral,
        'CollateralStatusChanged'
      )
      expect(await neweTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await neweTokenCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a EToken mock to be able to change the rate
      const ETokenMockFactory: ContractFactory = await ethers.getContractFactory('ETokenMock')
      const symbol = await eToken.symbol()
      const eTokenMock: ETokenMock = <ETokenMock>(
        await ETokenMockFactory.deploy(symbol + ' Token', symbol, params.tokenAddr as string)
      )

      // Set initial exchange rate to the new eToken Mock
      await eTokenMock.setExchangeRate(FP1)

      // Redeploy plugin using the new eToken mock
      const neweTokenCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>await (
        await ethers.getContractFactory('ETokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        params.fallBackPrice,
        await eTokenCollateral.chainlinkFeed(),
        eTokenMock.address,
        await eTokenCollateral.maxTradeVolume(),
        await eTokenCollateral.oracleTimeout(),
        await eTokenCollateral.targetName(),
        await eTokenCollateral.defaultThreshold(),
        await eTokenCollateral.delayUntilDefault(),
        await token.decimals()
      )

      // Check initial state
      expect(await neweTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await neweTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for eToken, will disable collateral immediately
      await eTokenMock.setExchangeRate(fp('0.99'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(neweTokenCollateral.refresh())
        .to.emit(neweTokenCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await neweTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await neweTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(18, bn('1e18'))
      )

      const invalidETokenCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>(
        await ETokenCollateralFactory.deploy(
          params.fallBackPrice,
          invalidChainlinkFeed.address,
          await eTokenCollateral.erc20(),
          await eTokenCollateral.maxTradeVolume(),
          await eTokenCollateral.oracleTimeout(),
          await eTokenCollateral.targetName(),
          await eTokenCollateral.defaultThreshold(),
          await eTokenCollateral.delayUntilDefault(),
          await token.decimals()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidETokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidETokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidETokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidETokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      console.log(
        '\n',
        '[ETokenFiatCollateral] Testing Done', '\n',
        '\n',
        )
    })
  })
})
