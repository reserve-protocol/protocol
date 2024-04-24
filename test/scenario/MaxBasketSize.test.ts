import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, divCeil, fp, pow10, toBNDecimals } from '../../common/numbers'
import {
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeTest,
  FiatCollateral,
  IAssetRegistry,
  TestIFacade,
  TestIStRSR,
  MockV3Aggregator,
  StaticATokenMock,
  TestIBackingManager,
  TestIBasketHandler,
  TestIRToken,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import {
  defaultFixtureNoBasket,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
} from '../fixtures'
import { CollateralStatus } from '../../common/constants'
import snapshotGasCost from '../utils/snapshotGasCost'
import { expectTrade } from '../utils/trades'
import { expectPrice, setOraclePrice } from '../utils/oracles'

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const REPORT_GAS = process.env.REPORT_GAS
const describeGas = REPORT_GAS ? describe.only : describe

describe(`Max Basket Size - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Non-backing assets
  let compoundMock: ComptrollerMock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock

  // Tokens and Assets
  let initialBal: BigNumber
  let rewardAmount: BigNumber

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let rsr: ERC20Mock
  let stRSR: TestIStRSR
  let assetRegistry: IAssetRegistry
  let basketHandler: TestIBasketHandler
  let facade: TestIFacade
  let facadeTest: FacadeTest
  let backingManager: TestIBackingManager

  // Computes the minBuyAmt for a sellAmt at two prices
  // sellPrice + buyPrice should not be the low and high estimates, but rather the oracle prices
  const toMinBuyAmt = (
    sellAmt: BigNumber,
    sellPrice: BigNumber,
    buyPrice: BigNumber,
    oracleError: BigNumber,
    maxTradeSlippage: BigNumber
  ): BigNumber => {
    // do all muls first so we don't round unnecessarily
    // a = loss due to max trade slippage
    // b = loss due to selling token at the low price
    // c = loss due to buying token at the high price
    // mirrors the math from TradeLib ~L:57

    const lowSellPrice = sellPrice.sub(sellPrice.mul(oracleError).div(fp('1')))
    const highBuyPrice = buyPrice.add(buyPrice.mul(oracleError).div(fp('1')))
    const product = sellAmt
      .mul(fp('1').sub(maxTradeSlippage)) // (a)
      .mul(lowSellPrice) // (b)

    return divCeil(divCeil(product, highBuyPrice), fp('1')) // (c)
  }

  const setBasket = async (
    maxBasketSize: number,
    numBackupTokens: number,
    onlyFiatcoins: boolean
  ) => {
    const basketTargetAmt = fp('1')
    const primeERC20s = []
    const targetAmts = []

    if (onlyFiatcoins) {
      for (let i = 0; i < maxBasketSize; i++) {
        const erc20 = await makeToken(`Token ${i}`)
        primeERC20s.push(erc20.address)
        targetAmts.push(basketTargetAmt.div(maxBasketSize))
      }
    } else {
      const numATokens = Math.ceil(maxBasketSize / 2)

      // Make half of basket ATokens
      let i = 0
      for (i; i < numATokens; i++) {
        const erc20 = await makeAToken(`Token ${i}`)
        primeERC20s.push(erc20.address)
        targetAmts.push(basketTargetAmt.div(maxBasketSize))
      }

      // Make the other half CTokens
      for (i; i < maxBasketSize; i++) {
        const erc20 = await makeCToken(`Token ${i}`)
        primeERC20s.push(erc20.address)
        targetAmts.push(basketTargetAmt.div(maxBasketSize))
      }
    }

    // Set backup
    const backups: string[] = []
    for (let i = 0; i < numBackupTokens; i++) {
      // reuse erc20 if possible
      const erc20Addr = i < maxBasketSize ? primeERC20s[i] : (await makeToken(`Token ${i}`)).address
      backups.push(erc20Addr)
    }
    const targetUnit = ethers.utils.formatBytes32String('USD')
    await basketHandler.setBackupConfig(targetUnit, maxBasketSize, backups)

    // Set prime basket with all collateral
    await basketHandler.setPrimeBasket(primeERC20s, targetAmts)
    await basketHandler.connect(owner).refreshBasket()
  }

  const makeToken = async (tokenName: string): Promise<ERC20Mock> => {
    const ERC20MockFactory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
    const CollateralFactory: ContractFactory = await ethers.getContractFactory('FiatCollateral')

    const erc20: ERC20Mock = <ERC20Mock>(
      await ERC20MockFactory.deploy(tokenName, `${tokenName} symbol`)
    )
    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    const collateral: FiatCollateral = <FiatCollateral>await CollateralFactory.deploy({
      priceTimeout: PRICE_TIMEOUT,
      chainlinkFeed: chainlinkFeed.address,
      oracleError: ORACLE_ERROR,
      erc20: erc20.address,
      maxTradeVolume: config.rTokenMaxTradeVolume,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD,
      delayUntilDefault: DELAY_UNTIL_DEFAULT,
    })

    await assetRegistry.register(collateral.address)
    return erc20
  }

  const makeAToken = async (tokenName: string): Promise<StaticATokenMock> => {
    const ERC20MockFactory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
    const ATokenMockFactory: ContractFactory = await ethers.getContractFactory('StaticATokenMock')
    const ATokenCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'ATokenFiatCollateral'
    )

    const erc20: ERC20Mock = <ERC20Mock>(
      await ERC20MockFactory.deploy(tokenName, `${tokenName} symbol`)
    )

    const atoken: StaticATokenMock = <StaticATokenMock>(
      await ATokenMockFactory.deploy('a' + tokenName, `${'a' + tokenName} symbol`, erc20.address)
    )

    // Set reward token and rewards
    await atoken.setAaveToken(aaveToken.address)
    await atoken.setRewards(backingManager.address, rewardAmount)

    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    const collateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
      await ATokenCollateralFactory.deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: chainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: atoken.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        },
        REVENUE_HIDING
      )
    )

    await assetRegistry.register(collateral.address)
    return atoken
  }

  const makeCToken = async (tokenName: string): Promise<CTokenMock> => {
    const ERC20MockFactory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
    const CTokenMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')
    const CTokenCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'CTokenFiatCollateral'
    )

    const erc20: ERC20Mock = <ERC20Mock>(
      await ERC20MockFactory.deploy(tokenName, `${tokenName} symbol`)
    )

    const ctoken: CTokenMock = <CTokenMock>(
      await CTokenMockFactory.deploy(
        'c' + tokenName,
        `${'c' + tokenName} symbol`,
        erc20.address,
        compoundMock.address
      )
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    const collateral: CTokenFiatCollateral = <CTokenFiatCollateral>(
      await CTokenCollateralFactory.deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: chainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: ctoken.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        },
        REVENUE_HIDING
      )
    )

    await assetRegistry.register(collateral.address)

    return ctoken
  }

  const prepareBacking = async (backing: string[]) => {
    for (let i = 0; i < backing.length; i++) {
      const erc20 = await ethers.getContractAt('ERC20Mock', backing[i])
      await erc20.mint(addr1.address, initialBal)
      await erc20.connect(addr1).approve(rToken.address, initialBal)

      // Grant allowances
      await backingManager.grantRTokenAllowance(erc20.address)
    }
  }

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Deploy fixture
    ;({
      compoundMock,
      compToken,
      aaveToken,
      config,
      rToken,
      rsr,
      stRSR,
      assetRegistry,
      backingManager,
      basketHandler,
      facade,
      facadeTest,
    } = await loadFixture(defaultFixtureNoBasket))

    // Mint initial balances
    initialBal = bn('10000e18')
    rewardAmount = bn('0.5e18')
  })

  describeGas('Fiatcoins', function () {
    const maxBasketSize = 64
    const numBackupTokens = 1
    const tokensToDefault = 63

    beforeEach(async () => {
      // Setup Max Basket - Only fiatcoins = true
      await setBasket(maxBasketSize, numBackupTokens, true)
    })

    it('Should Issue/Redeem with max basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing: string[] = await facade.basketTokens(rToken.address)
      expect(backing.length).to.equal(maxBasketSize)

      // Check other values
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)

      // Mint and approve initial balances
      await prepareBacking(backing)

      // Issue
      const issueAmt = initialBal.div(100)
      if (REPORT_GAS) {
        await snapshotGasCost(rToken.connect(addr1).issue(issueAmt))
      } else {
        await rToken.connect(addr1).issue(issueAmt)
      }
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)

      // Redemption
      if (REPORT_GAS) {
        await snapshotGasCost(rToken.connect(addr1).redeem(issueAmt))
      } else {
        await rToken.connect(addr1).redeem(issueAmt)
      }
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should switch basket correctly', async () => {
      const backing = await facade.basketTokens(rToken.address)

      // Mint and approve initial balances
      await prepareBacking(backing)

      // Issue
      const issueAmt = initialBal.div(100)
      await rToken.connect(addr1).issue(issueAmt)

      // Stake RSR
      await rsr.connect(owner).mint(addr1.address, issueAmt.mul(1e9))
      await rsr.connect(addr1).approve(stRSR.address, issueAmt.mul(1e9))
      await stRSR.connect(addr1).stake(issueAmt.mul(1e9))

      // Basket Swapping
      const firstCollateral = await ethers.getContractAt(
        'FiatCollateral',
        await assetRegistry.toColl(backing[0])
      )
      for (let i = maxBasketSize - tokensToDefault; i < backing.length; i++) {
        const erc20Collateral = await ethers.getContractAt(
          'FiatCollateral',
          await assetRegistry.toColl(backing[i])
        )
        await setOraclePrice(erc20Collateral.address, bn('0.5e8'))

        // Mark Collateral as IFFY
        await erc20Collateral.refresh()
        expect(await erc20Collateral.status()).to.equal(CollateralStatus.IFFY)
      }
      expect(await firstCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Advance time post delayUntilDefault
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())

      // Confirm default
      for (let i = 1; i < backing.length; i++) {
        const erc20Collateral = await ethers.getContractAt(
          'FiatCollateral',
          await assetRegistry.toColl(backing[i])
        )
        // Confirm default
        await erc20Collateral.refresh()
        expect(await erc20Collateral.status()).to.equal(CollateralStatus.DISABLED)
      }
      expect(await firstCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Ensure valid basket
      if (REPORT_GAS) {
        await snapshotGasCost(basketHandler.refreshBasket())
      } else {
        await basketHandler.refreshBasket()
      }

      // Advance time post warmup period - SOUND just regained
      await advanceTime(Number(config.warmupPeriod) + 1)

      // Check new basket
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      const newBacking: string[] = await facade.basketTokens(rToken.address)
      expect(newBacking.length).to.equal(maxBasketSize - tokensToDefault)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Running auctions will trigger recollateralization - All balance of invalid tokens will be redeemed
      const firstDefaultedToken = await ethers.getContractAt('ERC20Mock', backing[1])

      const sellAmt: BigNumber = await firstDefaultedToken.balanceOf(backingManager.address)
      const minBuyAmt: BigNumber = toMinBuyAmt(
        sellAmt,
        fp('0.5'),
        fp('1'),
        ORACLE_ERROR,
        config.maxTradeSlippage
      )
      if (REPORT_GAS) {
        await snapshotGasCost(facadeTest.runAuctionsForAllTraders(rToken.address))
      } else {
        await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(anyValue, firstDefaultedToken.address, backing[0], sellAmt, minBuyAmt)
      }
      const auctionTimestamp = await getLatestBlockTimestamp()

      // Token1 -> Token0 (Only valid backup token)
      await expectTrade(backingManager, {
        sell: firstDefaultedToken.address,
        buy: backing[0],
        endTime: auctionTimestamp + Number(config.batchAuctionLength),
        externalId: bn('0'),
      })
    })
  })

  describeGas('ATokens/CTokens', function () {
    const maxBasketSize = 64
    const numBackupTokens = 64
    const tokensToDefault = 20

    beforeEach(async () => {
      // Setup Max Basket - Only fiatcoins = false (use Atokens/CTokens)
      await setBasket(maxBasketSize, numBackupTokens, false)
    })

    it('Should Issue/Redeem with max basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing: string[] = await facade.basketTokens(rToken.address)
      expect(backing.length).to.equal(maxBasketSize)

      // Check other values
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)

      // Mint and approve initial balances
      await prepareBacking(backing)

      // Issue
      const issueAmt = initialBal.div(100)
      if (REPORT_GAS) {
        await snapshotGasCost(rToken.connect(addr1).issue(issueAmt))
      } else {
        await rToken.connect(addr1).issue(issueAmt)
      }
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)

      // Redemption
      if (REPORT_GAS) {
        await snapshotGasCost(rToken.connect(addr1).redeem(issueAmt))
      } else {
        await rToken.connect(addr1).redeem(issueAmt)
      }
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should switch basket correctly', async () => {
      const backing = await facade.basketTokens(rToken.address)

      // Mint and approve initial balances
      await prepareBacking(backing)

      // Issue
      const issueAmt = initialBal.div(100)
      await rToken.connect(addr1).issue(issueAmt)

      // Basket Swapping - Default CTokens
      // Will be replaced by existing ATokens
      const firstCollateral = await ethers.getContractAt(
        'ATokenFiatCollateral',
        await assetRegistry.toColl(backing[0])
      )
      for (let i = maxBasketSize - tokensToDefault; i < backing.length; i++) {
        const erc20 = await ethers.getContractAt('CTokenMock', backing[i])
        // Decrease rate to cause default in Ctoken
        await erc20.setExchangeRate(fp('0.8'))

        const erc20Collateral = await ethers.getContractAt(
          'CTokenFiatCollateral',
          await assetRegistry.toColl(erc20.address)
        )

        // Mark Collateral as Defaulted
        await erc20Collateral.refresh()
        expect(await erc20Collateral.status()).to.equal(CollateralStatus.DISABLED)
      }
      expect(await firstCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Advance time post delayUntilDefault
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())

      // Ensure valid basket
      if (REPORT_GAS) {
        await snapshotGasCost(basketHandler.refreshBasket())
      } else {
        await basketHandler.refreshBasket()
      }

      // Advance time post warmup period - SOUND just regained
      await advanceTime(Number(config.warmupPeriod) + 1)

      // Check new basket
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      const newBacking: string[] = await facade.basketTokens(rToken.address)
      expect(newBacking.length).to.equal(maxBasketSize - tokensToDefault)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Running auctions will trigger recollateralization - All balance of invalid tokens will be redeemed
      const firstDefaultedToken = await ethers.getContractAt(
        'ERC20Mock',
        backing[maxBasketSize - tokensToDefault]
      )
      //const sellAmt: BigNumber = await firstDefaultedToken.balanceOf(backingManager.address)
      const sellAmt: BigNumber = (await firstDefaultedToken.balanceOf(backingManager.address)).mul(
        pow10(10)
      ) // convert to 18 decimals for simplification

      // CToken sell price: 0.02, reduced 0.8 rate -> 0.016
      const minBuyAmt: BigNumber = toMinBuyAmt(
        sellAmt,
        fp('0.016'),
        fp('1'),
        ORACLE_ERROR,
        config.maxTradeSlippage
      )

      if (REPORT_GAS) {
        await snapshotGasCost(facadeTest.runAuctionsForAllTraders(rToken.address))
      } else {
        await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(
            anyValue,
            firstDefaultedToken.address,
            backing[0],
            toBNDecimals(sellAmt, 8),
            minBuyAmt
          )
      }
      const auctionTimestamp = await getLatestBlockTimestamp()

      // Defaulted -> Token0 (First valid backup token)
      await expectTrade(backingManager, {
        sell: firstDefaultedToken.address,
        buy: backing[0],
        endTime: auctionTimestamp + Number(config.batchAuctionLength),
        externalId: bn('0'),
      })
    })

    it('Should claim rewards correctly', async () => {
      // COMP Rewards - Set only once
      await compoundMock.setRewards(backingManager.address, rewardAmount.mul(20))

      // Check balances before
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

      // Claim Rewards
      if (REPORT_GAS) {
        await snapshotGasCost(backingManager.claimRewards())
      } else {
        await backingManager.claimRewards()
      }

      // Check balances after
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(
        rewardAmount.mul(Math.ceil(maxBasketSize / 2))
      )
      expect(await compToken.balanceOf(backingManager.address)).to.equal(rewardAmount.mul(20))
    })
  })
})
