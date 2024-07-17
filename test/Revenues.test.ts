import { useEnv } from '#/utils/env'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { getStorageAt, loadFixture, setStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet, constants } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { GNOSIS_MAX_TOKENS, IConfig } from '../common/configuration'
import {
  BN_SCALE_FACTOR,
  CollateralStatus,
  FURNACE_DEST,
  MAX_UINT192,
  ONE_PERIOD,
  STRSR_DEST,
  TradeKind,
  ZERO_ADDRESS,
  BidType,
} from '../common/constants'
import { expectEvents } from '../common/events'
import { bn, divCeil, fp, near } from '../common/numbers'
import {
  ATokenFiatCollateral,
  Asset,
  CTokenFiatCollateral,
  CTokenMock,
  ComptrollerMock,
  ERC20Mock,
  FacadeTest,
  FiatCollateral,
  GnosisMock,
  IAssetRegistry,
  InvalidATokenFiatCollateralMock,
  MockV3Aggregator,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIBasketHandler,
  TestIBroker,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRToken,
  TestIRevenueTrader,
  TestIStRSR,
  USDCMock,
} from '../typechain'
import {
  Collateral,
  IMPLEMENTATION,
  Implementation,
  ORACLE_ERROR,
  DECAY_DELAY,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
  defaultFixture,
} from './fixtures'
import { whileImpersonating } from './utils/impersonation'
import { withinTolerance } from './utils/matchers'
import { expectRTokenPrice, setOraclePrice } from './utils/oracles'
import snapshotGasCost from './utils/snapshotGasCost'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from './utils/time'
import { mintCollaterals } from './utils/tokens'
import { dutchBuyAmount, expectTrade, getTrade } from './utils/trades'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

const itP1 = IMPLEMENTATION == Implementation.P1 ? it : it.skip

describe(`Revenues - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: Asset
  let compToken: ERC20Mock
  let compoundMock: ComptrollerMock
  let aaveToken: ERC20Mock
  let aaveAsset: Asset

  // Trading
  let gnosis: GnosisMock
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let broker: TestIBroker

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: FiatCollateral
  let collateral1: FiatCollateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral
  let collateral: Collateral[]
  let erc20s: ERC20Mock[]
  let basket: Collateral[]
  let rTokenAsset: RTokenAsset

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let furnace: TestIFurnace
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler
  let distributor: TestIDistributor
  let main: TestIMain

  let AssetFactory: ContractFactory

  // Computes the minBuyAmt for a sellAmt at two prices
  // sellPrice + buyPrice should not be the low and high estimates, but rather the oracle prices
  const toMinBuyAmt = async (
    sellAmt: BigNumber,
    sellPrice: BigNumber,
    buyPrice: BigNumber
  ): Promise<BigNumber> => {
    // do all muls first so we don't round unnecessarily
    // a = loss due to max trade slippage
    // b = loss due to selling token at the low price
    // c = loss due to buying token at the high price
    // mirrors the math from TradeLib ~L:57

    const lowSellPrice = sellPrice.sub(sellPrice.mul(ORACLE_ERROR).div(BN_SCALE_FACTOR))
    const highBuyPrice = buyPrice.add(buyPrice.mul(ORACLE_ERROR).div(BN_SCALE_FACTOR))
    const product = sellAmt
      .mul(fp('1').sub(await rTokenTrader.maxTradeSlippage())) // (a)
      .mul(lowSellPrice) // (b)

    return divCeil(divCeil(product, highBuyPrice), fp('1')) // (c)
  }

  const disableBatchTrade = async () => {
    if (IMPLEMENTATION == Implementation.P1) {
      const slot = await getStorageAt(broker.address, 205)
      await setStorageAt(
        broker.address,
        205,
        slot.replace(slot.slice(2, 14), '1'.padStart(12, '0'))
      )
    } else {
      const slot = await getStorageAt(broker.address, 56)
      await setStorageAt(broker.address, 56, slot.replace(slot.slice(2, 42), '1'.padStart(40, '0')))
    }
    expect(await broker.batchTradeDisabled()).to.equal(true)
  }

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      aaveAsset,
      aaveToken,
      compoundMock,
      erc20s,
      collateral,
      basket,
      config,
      assetRegistry,
      backingManager,
      basketHandler,
      distributor,
      rToken,
      furnace,
      stRSR,
      broker,
      gnosis,
      facadeTest,
      rsrTrader,
      rTokenTrader,
      main,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    AssetFactory = await ethers.getContractFactory('Asset')

    // Set backingBuffer to 0 to make math easy
    await backingManager.connect(owner).setBackingBuffer(0)

    // Get assets and tokens
    collateral0 = <FiatCollateral>basket[0]
    collateral1 = <FiatCollateral>basket[1]
    collateral2 = <ATokenFiatCollateral>basket[2]
    collateral3 = <CTokenFiatCollateral>basket[3]
    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <USDCMock>await ethers.getContractAt('USDCMock', await collateral1.erc20())
    token2 = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())

    // Mint initial balances
    initialBal = bn('1000000e18')
    await mintCollaterals(owner, [addr1, addr2], initialBal, basket)
    if (IMPLEMENTATION === Implementation.P1) {
      await (await ethers.getContractAt('RevenueTraderP1', rTokenTrader.address)).cacheComponents()
      await (await ethers.getContractAt('RevenueTraderP1', rsrTrader.address)).cacheComponents()
    }
  })

  describe('Deployment', () => {
    it('Should setup RevenueTraders correctly', async () => {
      expect(await rsrTrader.main()).to.equal(main.address)
      expect(await rsrTrader.tokenToBuy()).to.equal(rsr.address)
      expect(await rsrTrader.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await rsrTrader.minTradeVolume()).to.equal(config.minTradeVolume)

      expect(await rTokenTrader.main()).to.equal(main.address)
      expect(await rTokenTrader.tokenToBuy()).to.equal(rToken.address)
      expect(await rTokenTrader.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await rsrTrader.minTradeVolume()).to.equal(config.minTradeVolume)
    })

    it('Should perform validations on init', async () => {
      if (IMPLEMENTATION == Implementation.P0) {
        // Create RevenueTrader Factory
        const RevenueTraderFactory: ContractFactory = await ethers.getContractFactory(
          'RevenueTraderP0'
        )

        const newTrader = <TestIRevenueTrader>await RevenueTraderFactory.deploy()

        await expect(
          newTrader.init(main.address, ZERO_ADDRESS, bn('100'), config.minTradeVolume)
        ).to.be.revertedWith('invalid token address')
      } else if (IMPLEMENTATION == Implementation.P1) {
        const RevenueTraderFactory: ContractFactory = await ethers.getContractFactory(
          'RevenueTraderP1'
        )

        const newTrader = <TestIRevenueTrader>await upgrades.deployProxy(RevenueTraderFactory, [], {
          kind: 'uups',
          unsafeAllow: ['delegatecall'], // TradingLib
        })

        await expect(
          newTrader.init(main.address, ZERO_ADDRESS, bn('100'), config.minTradeVolume)
        ).to.be.revertedWith('invalid token address')
      }
    })
  })

  describe('Config/Setup', function () {
    it('Should setup initial distribution correctly', async () => {
      // Configuration
      const [rTokenTotal, rsrTotal] = await distributor.totals()
      expect(rsrTotal).equal(bn(6000))
      expect(rTokenTotal).equal(bn(4000))
    })

    it('Should allow to set distribution if owner', async () => {
      // Check initial status
      const [rTokenTotal, rsrTotal] = await distributor.totals()
      expect(rsrTotal).equal(bn(6000))
      expect(rTokenTotal).equal(bn(4000))

      // Attempt to update with another account
      await expect(
        distributor.connect(other).setDistributions(
          [STRSR_DEST, FURNACE_DEST],
          [
            { rTokenDist: bn(0), rsrDist: bn(10000) },
            { rTokenDist: bn(0), rsrDist: bn(0) },
          ]
        )
      ).to.be.revertedWith('governance only')

      // Update with owner - Set f = 1
      await expect(
        distributor.connect(owner).setDistributions(
          [STRSR_DEST, FURNACE_DEST],
          [
            { rTokenDist: bn(0), rsrDist: bn(10000) },
            { rTokenDist: bn(0), rsrDist: bn(0) },
          ]
        )
      )
        .to.emit(distributor, 'DistributionSet')
        .withArgs(FURNACE_DEST, bn(0), bn(0))

      // Check updated status
      const [newRTokenTotal, newRsrTotal] = await distributor.totals()
      expect(newRsrTotal).equal(bn(10000))
      expect(newRTokenTotal).equal(bn(0))
    })

    it('Should perform distribution validations', async () => {
      // Cannot set RSR > 0 for Furnace
      await expect(
        distributor
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(10000) })
      ).to.be.revertedWith('Furnace must get 0% of RSR')

      // Cannot set RToken > 0 for StRSR
      await expect(
        distributor
          .connect(owner)
          .setDistribution(STRSR_DEST, { rTokenDist: bn(10000), rsrDist: bn(0) })
      ).to.be.revertedWith('StRSR must get 0% of RToken')

      // Cannot set RSR distribution too high
      await expect(
        distributor
          .connect(owner)
          .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(10001) })
      ).to.be.revertedWith('RSR distribution too high')

      // Cannot set RToken distribution too high
      await expect(
        distributor
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(10001), rsrDist: bn(0) })
      ).to.be.revertedWith('RToken distribution too high')

      // Cannot set both distributions below MAX_DISTRIBUTION
      await expect(
        distributor.connect(owner).setDistributions(
          [FURNACE_DEST, STRSR_DEST],
          [
            { rTokenDist: bn(1), rsrDist: bn(0) },
            { rTokenDist: bn(0), rsrDist: bn(1) },
          ]
        )
      ).to.be.reverted
      await expect(
        distributor.connect(owner).setDistributions(
          [FURNACE_DEST, STRSR_DEST],
          [
            { rTokenDist: bn(0), rsrDist: bn(0) },
            { rTokenDist: bn(0), rsrDist: bn(0) },
          ]
        )
      ).to.be.reverted

      // Cannot set zero addr beneficiary
      await expect(
        distributor
          .connect(owner)
          .setDistribution(ZERO_ADDRESS, { rTokenDist: bn(5), rsrDist: bn(5) })
      ).to.be.revertedWith('dest cannot be zero')

      // Cannot set Furnace as beneficiary
      await expect(
        distributor
          .connect(owner)
          .setDistribution(furnace.address, { rTokenDist: bn(5), rsrDist: bn(5) })
      ).to.be.revertedWith('destination can not be furnace or strsr directly')

      // Cannot set StRSR as beneficiary
      await expect(
        distributor
          .connect(owner)
          .setDistribution(stRSR.address, { rTokenDist: bn(5), rsrDist: bn(5) })
      ).to.be.revertedWith('destination can not be furnace or strsr directly')
    })

    itP1('Should not allow to set Dao fee explicitly', async () => {
      // Cannot set DAO fee explicitly
      await main.connect(owner).setDAOFeeRegistry(other.address)
      await expect(
        distributor
          .connect(owner)
          .setDistribution(other.address, { rTokenDist: bn(10000), rsrDist: bn(0) })
      ).to.be.revertedWith('destination cannot be daoFeeRegistry')
    })

    it('Should validate number of destinations', async () => {
      // Cannot set more than Max (100)
      const maxDestinations = 100

      for (let i = 0; i < maxDestinations - 2; i++) {
        const usr: Wallet = await ethers.Wallet.createRandom()
        await distributor
          .connect(owner)
          .setDistribution(usr.address, { rTokenDist: bn(4000), rsrDist: bn(6000) })
      }

      // Attempt to add an additional destination will revert
      await expect(
        distributor
          .connect(owner)
          .setDistribution(other.address, { rTokenDist: bn(4000), rsrDist: bn(6000) })
      ).to.be.revertedWith('Too many destinations')
    })
  })

  describe('Revenues', function () {
    context('With issued Rtokens', function () {
      let issueAmount: BigNumber
      let rewardAmountCOMP: BigNumber
      let rewardAmountAAVE: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100000e18')

        // Provide approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)
        await token1.connect(addr1).approve(rToken.address, initialBal)
        await token2.connect(addr1).approve(rToken.address, initialBal)
        await token3.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should not trade if paused', async () => {
        await main.connect(owner).pauseTrading()
        await expect(
          rsrTrader.manageTokens([ZERO_ADDRESS], [TradeKind.BATCH_AUCTION])
        ).to.be.revertedWith('frozen or trading paused')
      })

      it('Should not trade if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(
          rTokenTrader.manageTokens([ZERO_ADDRESS], [TradeKind.BATCH_AUCTION])
        ).to.be.revertedWith('frozen or trading paused')
      })

      it('Should not claim rewards if paused', async () => {
        await main.connect(owner).pauseTrading()
        await expect(rTokenTrader.claimRewards()).to.be.revertedWith('frozen or trading paused')
      })

      it('Should not claim rewards if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(rTokenTrader.claimRewards()).to.be.revertedWith('frozen or trading paused')
      })

      it('Should not claim single rewards if paused', async () => {
        await main.connect(owner).pauseTrading()
        await expect(rTokenTrader.claimRewardsSingle(token2.address)).to.be.revertedWith(
          'frozen or trading paused'
        )
      })

      it('Should not claim single rewards if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(rTokenTrader.claimRewardsSingle(token2.address)).to.be.revertedWith(
          'frozen or trading paused'
        )
      })

      it('should claim a single reward', async () => {
        const rewardAmt = bn('100e18')
        await token2.setRewards(backingManager.address, rewardAmt)
        await backingManager.claimRewardsSingle(token2.address)
        const balAfter = await aaveToken.balanceOf(backingManager.address)
        expect(balAfter).to.equal(rewardAmt)
      })

      it('Should still launch revenue auction if IFFY', async () => {
        // Depeg one of the underlying tokens - Reducing price 30%
        await setOraclePrice(collateral0.address, bn('7e7'))
        await collateral0.refresh()
        await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
        await expect(rTokenTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION]))
          .to.emit(rTokenTrader, 'TradeStarted')
          .withArgs(anyValue, token0.address, rToken.address, issueAmount, anyValue)
      })

      it('Should forward revenue to traders', async () => {
        const rewardAmt = bn('100e18')
        await token2.setRewards(backingManager.address, rewardAmt)
        await backingManager.claimRewardsSingle(token2.address)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        await expect(backingManager.forwardRevenue([aaveToken.address])).to.emit(
          aaveToken,
          'Transfer'
        )
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(
          rewardAmt.mul(6000).div(10000)
        )
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(
          rewardAmt.mul(4000).div(10000)
        )
      })

      it('Should not forward revenue if basket not ready', async () => {
        const rewardAmt = bn('100e18')
        await token2.setRewards(backingManager.address, rewardAmt)
        await backingManager.claimRewardsSingle(token2.address)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Default a token and update basket status
        await setOraclePrice(collateral0.address, bn('0.5e8'))
        await collateral0.refresh()
        expect(await collateral0.status()).to.equal(CollateralStatus.IFFY)
        await basketHandler.trackStatus()

        // Cannot forward if not SOUND
        await expect(backingManager.forwardRevenue([aaveToken.address])).to.be.revertedWith(
          'basket not ready'
        )

        // Regain SOUND
        await setOraclePrice(collateral0.address, bn('1e8'))
        await collateral0.refresh()
        expect(await collateral0.status()).to.equal(CollateralStatus.SOUND)
        await basketHandler.trackStatus()

        // Still cannot forward revenue, in warmup period
        await expect(backingManager.forwardRevenue([aaveToken.address])).to.be.revertedWith(
          'basket not ready'
        )

        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Advance time post warmup period
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Now we can forward revenue successfully
        await expect(backingManager.forwardRevenue([aaveToken.address])).to.emit(
          aaveToken,
          'Transfer'
        )
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(
          rewardAmt.mul(6000).div(10000)
        )
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(
          rewardAmt.mul(4000).div(10000)
        )
      })

      it('Should not forward revenue if paused', async () => {
        const rewardAmt = bn('100e18')
        await token2.setRewards(backingManager.address, rewardAmt)
        await backingManager.claimRewardsSingle(token2.address)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Pause
        await main.connect(owner).pauseTrading()

        // Cannot forward revenue
        await expect(backingManager.forwardRevenue([aaveToken.address])).to.be.revertedWith(
          'frozen or trading paused'
        )
      })

      it('Should not forward revenue if frozen', async () => {
        const rewardAmt = bn('100e18')
        await token2.setRewards(backingManager.address, rewardAmt)
        await backingManager.claimRewardsSingle(token2.address)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Pause
        await main.connect(owner).freezeShort()

        // Cannot forward revenue
        await expect(backingManager.forwardRevenue([aaveToken.address])).to.be.revertedWith(
          'frozen or trading paused'
        )
      })

      it('Should forward RSR revenue directly to StRSR and call payoutRewards()', async () => {
        const amount = bn('2000e18')
        await rsr.connect(owner).mint(backingManager.address, amount)
        expect(await rsr.balanceOf(backingManager.address)).to.equal(amount)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rsr.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rsr.balanceOf(rTokenTrader.address)).to.equal(0)

        // Advance to the end of noop period
        await advanceTime(Number(ONE_PERIOD))

        await expectEvents(backingManager.forwardRevenue([rsr.address]), [
          {
            contract: rsr,
            name: 'Transfer',
            args: [backingManager.address, stRSR.address, amount],
            emitted: true,
          },
          {
            contract: stRSR,
            name: 'RewardsPaid',
            emitted: true,
          },
        ])

        expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
        expect(await rsr.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rsr.balanceOf(rTokenTrader.address)).to.equal(0)
      })

      it('Should launch revenue auction if UNPRICED', async () => {
        // After oracleTimeout it should still launch auction for RToken
        await advanceTime(DECAY_DELAY.toString())
        await rsr.connect(addr1).transfer(rTokenTrader.address, issueAmount)
        await rTokenTrader.callStatic.manageTokens([rsr.address], [TradeKind.BATCH_AUCTION])

        // After priceTimeout it should not buy RToken
        await advanceTime(PRICE_TIMEOUT.toString())
        await rsr.connect(addr1).transfer(rTokenTrader.address, issueAmount)
        await expect(
          rTokenTrader.manageTokens([rsr.address], [TradeKind.BATCH_AUCTION])
        ).to.be.revertedWith('buy asset price unknown')
      })

      it('Should not launch revenue auction if 0 erc20s len', async () => {
        await expect(rTokenTrader.manageTokens([], [])).to.be.revertedWith('empty erc20s list')
      })

      it('Should not launch revenue auction with uneven length lists', async () => {
        await expect(rTokenTrader.manageTokens([rsr.address], [])).to.be.revertedWith(
          'length mismatch'
        )
        await expect(
          rTokenTrader.manageTokens(
            [rsr.address],
            [TradeKind.BATCH_AUCTION, TradeKind.DUTCH_AUCTION]
          )
        ).to.be.revertedWith('length mismatch')
        await expect(
          rTokenTrader.manageTokens([rsr.address], [TradeKind.BATCH_AUCTION])
        ).to.not.be.revertedWith('length mismatch')
      })

      it('Should distribute tokenToBuy - distributeTokenToBuy()', async () => {
        // Use distributeTokenToBuy()
        const stRSRBal = await rsr.balanceOf(stRSR.address)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)
        await rsrTrader.distributeTokenToBuy()
        const expectedAmount = stRSRBal.add(issueAmount)
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(expectedAmount, 10000)
      })

      it('Should distribute tokenToBuy - manageTokens()', async () => {
        // Use manageTokens()
        const stRSRBal = await rsr.balanceOf(stRSR.address)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)
        await rsrTrader.manageTokens([rsr.address], [TradeKind.BATCH_AUCTION])
        const expectedAmount = stRSRBal.add(issueAmount)
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(expectedAmount, 10000)
      })

      it('Should not distribute tokenToBuy if frozen or trading paused', async () => {
        // Use distributeTokenToBuy()
        const stRSRBal = await rsr.balanceOf(stRSR.address)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)

        // Trading pause
        await main.connect(owner).pauseTrading()

        // Attempt to distribute
        await expect(rsrTrader.distributeTokenToBuy()).to.be.revertedWith(
          'frozen or trading paused'
        )

        // Revert pause and freeze
        await main.connect(owner).unpauseTrading()
        await main.connect(owner).freezeShort()

        // Attempt to distribute again
        await expect(rsrTrader.distributeTokenToBuy()).to.be.revertedWith(
          'frozen or trading paused'
        )

        // Unfreeze
        await main.connect(owner).unfreeze()

        // Can distribute now
        await rsrTrader.distributeTokenToBuy()
        const expectedAmount = stRSRBal.add(issueAmount)
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(expectedAmount, 10000)
      })

      it('Should distribute tokenToBuy before updating distribution', async () => {
        // Check initial status
        const [rTokenTotal, rsrTotal] = await distributor.totals()
        expect(rsrTotal).equal(bn(6000))
        expect(rTokenTotal).equal(bn(4000))

        // Set some balance of token-to-buy in traders
        const issueAmount = bn('100e18')

        // RSR Trader
        const stRSRBal = await rsr.balanceOf(stRSR.address)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)

        // RToken Trader
        const rTokenBal = await rToken.balanceOf(furnace.address)
        await rToken.connect(addr1).issueTo(rTokenTrader.address, issueAmount)

        // Update distributions with owner - Set f = 1
        await distributor.connect(owner).setDistributions(
          [STRSR_DEST, FURNACE_DEST],
          [
            { rTokenDist: bn(0), rsrDist: bn(10000) },
            { rTokenDist: bn(0), rsrDist: bn(0) },
          ]
        )

        // Check tokens were transferred from Traders
        const expectedAmountRSR = stRSRBal.add(issueAmount)
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(expectedAmountRSR, 10000)
        expect(await rsr.balanceOf(rsrTrader.address)).to.be.closeTo(bn(0), 10000)

        const expectedAmountRToken = rTokenBal.add(issueAmount)
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(expectedAmountRToken, 10000)
        expect(await rsr.balanceOf(rTokenTrader.address)).to.be.closeTo(bn(0), 10000)

        // Check updated distributions
        const [newRTokenTotal, newRsrTotal] = await distributor.totals()
        expect(newRsrTotal).equal(bn(10000))
        expect(newRTokenTotal).equal(bn(0))
      })

      it('Should avoid zero transfers when distributing tokenToBuy', async () => {
        // Distribute with no balance
        await expect(rsrTrader.distributeTokenToBuy()).to.be.revertedWith('nothing to distribute')
        expect(await rsr.balanceOf(stRSR.address)).to.equal(bn(0))

        // Small amount which ends in zero distribution due to rounding
        await rsr.connect(owner).mint(rsrTrader.address, bn(1))
        await expect(rsrTrader.distributeTokenToBuy()).to.be.revertedWith('nothing to distribute')
        expect(await rsr.balanceOf(stRSR.address)).to.equal(bn(0))
      })

      it('Should account rewards when distributing tokenToBuy', async () => {
        // 1. StRSR.payoutRewards()
        const stRSRBal = await rsr.balanceOf(stRSR.address)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)
        await advanceTime(Number(ONE_PERIOD))
        await expect(rsrTrader.distributeTokenToBuy()).to.emit(stRSR, 'RewardsPaid')
        const expectedAmountStRSR = stRSRBal.add(issueAmount)
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(expectedAmountStRSR, 10000)

        // 2. Furnace.melt()
        // Transfer RTokens to Furnace (to trigger melting later)
        const hndAmt: BigNumber = bn('10e18')
        await rToken.connect(addr1).transfer(furnace.address, hndAmt)
        await advanceTime(Number(ONE_PERIOD))
        await furnace.melt()

        // Transfer and distribute tokens in Trader (will melt)
        await advanceTime(Number(ONE_PERIOD))
        await rToken.connect(addr1).transfer(rTokenTrader.address, hndAmt)
        await expect(rTokenTrader.distributeTokenToBuy()).to.emit(rToken, 'Melted')
        const expectedAmountFurnace = hndAmt.mul(2)
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          expectedAmountFurnace,
          expectedAmountFurnace.div(1000)
        ) // within 0.1%
      })

      it('Should update distribution even if distributeTokenToBuy() reverts', async () => {
        // Check initial status
        const [rTokenTotal, rsrTotal] = await distributor.totals()
        expect(rsrTotal).equal(bn(6000))
        expect(rTokenTotal).equal(bn(4000))

        // Set some balance of token-to-buy in RSR trader
        const issueAmount = bn('100e18')
        const stRSRBal = await rsr.balanceOf(stRSR.address)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)

        // Pause the system, makes distributeTokenToBuy() revert
        await main.connect(owner).pauseTrading()
        await expect(rsrTrader.distributeTokenToBuy()).to.be.reverted

        // Update distributions with owner - Set f = 1
        await distributor.connect(owner).setDistributions(
          [STRSR_DEST, FURNACE_DEST],
          [
            { rTokenDist: bn(0), rsrDist: bn(10000) },
            { rTokenDist: bn(0), rsrDist: bn(0) },
          ]
        )

        // Check no tokens were transferred
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stRSRBal)
        expect(await rsr.balanceOf(rsrTrader.address)).to.equal(issueAmount)

        // Check updated distributions
        const [newRTokenTotal, newRsrTotal] = await distributor.totals()
        expect(newRsrTotal).equal(bn(10000))
        expect(newRTokenTotal).equal(bn(0))
      })

      it('Should return tokens to BackingManager correctly - rsrTrader.returnTokens()', async () => {
        // Mint tokens
        await token0.connect(owner).mint(rsrTrader.address, issueAmount.add(1))
        await token1.connect(owner).mint(rsrTrader.address, issueAmount.add(2))

        // Should fail when trading paused or frozen
        await main.connect(owner).pauseIssuance()
        await main.connect(owner).pauseTrading()
        await main.connect(owner).freezeForever()
        await expect(
          rsrTrader.returnTokens([rsr.address, token0.address, token1.address])
        ).to.be.revertedWith('frozen or trading paused')
        await main.connect(owner).unfreeze()
        await expect(
          rsrTrader.returnTokens([rsr.address, token0.address, token1.address])
        ).to.be.revertedWith('frozen or trading paused')
        await main.connect(owner).unpauseTrading()

        // Should fail when distribution is nonzero
        await expect(
          rsrTrader.returnTokens([rsr.address, token0.address, token1.address])
        ).to.be.revertedWith('rsrTotal > 0')
        await distributor.setDistributions(
          [FURNACE_DEST, STRSR_DEST],
          [
            { rTokenDist: bn(10000), rsrDist: bn(0) },
            { rTokenDist: bn('0'), rsrDist: bn('0') },
          ]
        )

        // Mint RSR
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)

        // Should fail for unregistered token
        await assetRegistry.connect(owner).unregister(collateral1.address)
        await expect(
          rsrTrader.returnTokens([rsr.address, token0.address, token1.address])
        ).to.be.revertedWith('unregistered erc20')

        // Succeed on just token0 + rsr
        await expectEvents(rsrTrader.returnTokens([rsr.address, token0.address]), [
          {
            contract: rsr,
            name: 'Transfer',
            args: [rsrTrader.address, backingManager.address, issueAmount],
            emitted: true,
          },
          {
            contract: token0,
            name: 'Transfer',
            args: [rsrTrader.address, backingManager.address, issueAmount.add(1)],
            emitted: true,
          },
          {
            contract: token1,
            name: 'Transfer',
            emitted: false,
          },
        ])
      })

      it('Should return tokens to BackingManager correctly - rTokenTrader.returnTokens()', async () => {
        // Mint tokens
        await rsr.connect(owner).mint(rTokenTrader.address, issueAmount)
        await token0.connect(owner).mint(rTokenTrader.address, issueAmount.add(1))
        await token1.connect(owner).mint(rTokenTrader.address, issueAmount.add(2))

        // Should fail when trading paused or frozen
        await main.connect(owner).pauseIssuance()
        await main.connect(owner).pauseTrading()
        await main.connect(owner).freezeForever()
        await expect(
          rTokenTrader.returnTokens([rsr.address, token0.address, token1.address])
        ).to.be.revertedWith('frozen or trading paused')
        await main.connect(owner).unfreeze()
        await expect(
          rTokenTrader.returnTokens([rsr.address, token0.address, token1.address])
        ).to.be.revertedWith('frozen or trading paused')
        await main.connect(owner).unpauseTrading()

        // Should fail when distribution is nonzero
        await expect(
          rTokenTrader.returnTokens([rsr.address, token0.address, token1.address])
        ).to.be.revertedWith('rTokenTotal > 0')
        await distributor.setDistributions(
          [FURNACE_DEST, STRSR_DEST],
          [
            { rTokenDist: bn(0), rsrDist: bn(0) },
            { rTokenDist: bn(0), rsrDist: bn(10000) },
          ]
        )

        // Should fail for unregistered token
        await assetRegistry.connect(owner).unregister(collateral1.address)
        await expect(
          rTokenTrader.returnTokens([rsr.address, token0.address, token1.address])
        ).to.be.revertedWith('unregistered erc20')

        // Succeed on just token0 + rsr
        await expectEvents(rTokenTrader.returnTokens([rsr.address, token0.address]), [
          {
            contract: rsr,
            name: 'Transfer',
            args: [rTokenTrader.address, backingManager.address, issueAmount],
            emitted: true,
          },
          {
            contract: token0,
            name: 'Transfer',
            args: [rTokenTrader.address, backingManager.address, issueAmount.add(1)],
            emitted: true,
          },
          {
            contract: token1,
            name: 'Transfer',
            emitted: false,
          },
        ])
      })

      it('Should launch multiple auctions -- has tokenToBuy', async () => {
        // Mint AAVE, token0, and RSR to the RSRTrader
        await aaveToken.connect(owner).mint(rsrTrader.address, issueAmount)
        await token0.connect(owner).mint(rsrTrader.address, issueAmount)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)

        // Start auctions
        await expectEvents(
          rsrTrader.manageTokens(
            [rsr.address, token0.address, aaveToken.address],
            [TradeKind.BATCH_AUCTION, TradeKind.BATCH_AUCTION, TradeKind.BATCH_AUCTION]
          ),
          [
            {
              contract: rsr,
              name: 'Transfer',
              args: [rsrTrader.address, stRSR.address, anyValue],
              emitted: true,
            },
            {
              contract: rsrTrader,
              name: 'TradeStarted',
              args: [anyValue, token0.address, rsr.address, issueAmount, anyValue],
              emitted: true,
            },
            {
              contract: rsrTrader,
              name: 'TradeStarted',
              args: [anyValue, aaveToken.address, rsr.address, issueAmount, anyValue],
              emitted: true,
            },
          ]
        )
      })

      it('Should launch multiple auctions -- involvesRToken', async () => {
        // Mint AAVE, token0, and RSR to the RSRTrader
        await rToken.connect(addr1).transfer(rsrTrader.address, issueAmount)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)

        // Start auctions
        await expectEvents(
          rsrTrader.manageTokens(
            [rsr.address, rToken.address],
            [TradeKind.BATCH_AUCTION, TradeKind.BATCH_AUCTION]
          ),
          [
            {
              contract: rsr,
              name: 'Transfer',
              args: [rsrTrader.address, stRSR.address, anyValue],
              emitted: true,
            },
            {
              contract: rsrTrader,
              name: 'TradeStarted',
              args: [anyValue, rToken.address, rsr.address, issueAmount, anyValue],
              emitted: true,
            },
          ]
        )
      })

      it('Should launch revenue auction if DISABLED with nonzero minBuyAmount', async () => {
        await setOraclePrice(collateral0.address, bn('0.5e8'))
        await collateral0.refresh()
        await advanceTime((await collateral0.delayUntilDefault()).toString())
        expect(await collateral0.status()).to.equal(CollateralStatus.DISABLED)
        await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
        await expect(
          rTokenTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])
        ).to.emit(rTokenTrader, 'TradeStarted')

        // Trade should have extremely nonzero worst-case price
        const trade = await getTrade(rTokenTrader, token0.address)
        expect(await trade.initBal()).to.equal(issueAmount)
        expect(await trade.worstCasePrice()).to.be.gte(fp('0.485').mul(bn('1e9'))) // D27 precision
      })

      it('Should claim COMP and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountCOMP.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, bn(0)],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, compToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              compToken.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: compToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await compToken.balanceOf(gnosis.address)).to.equal(rewardAmountCOMP)

        // If we attempt to settle before auction ended it reverts
        await expect(rsrTrader.settleTrade(compToken.address)).to.be.revertedWith(
          'cannot settle yet'
        )

        await expect(rTokenTrader.settleTrade(compToken.address)).to.be.revertedWith(
          'cannot settle yet'
        )

        // Nothing occurs if we attempt to settle for a token that is not being traded
        await expect(rsrTrader.settleTrade(aaveToken.address)).to.not.emit
        await expect(rTokenTrader.settleTrade(aaveToken.address)).to.not.emit

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check balances sent to corresponding destinations; won't be exact because distributor rounds
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(
          minBuyAmt,
          minBuyAmt.div(bn('1e13'))
        )
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.closeTo(
          minBuyAmtRToken,
          minBuyAmtRToken.div(bn('1e13'))
        )
      })

      it('Should be able to start a dust auction BATCH_AUCTION, if enabled', async () => {
        const minTrade = bn('1e18')

        await rTokenTrader.connect(owner).setMinTradeVolume(minTrade)

        await collateral0.refresh()

        const dustAmount = bn('1e17')
        await token0.connect(addr1).transfer(rTokenTrader.address, dustAmount)

        const p1RevenueTrader = await ethers.getContractAt('RevenueTraderP1', rTokenTrader.address)

        // Disable batch auctions, should not start auction
        await broker.connect(owner).setBatchAuctionLength(bn(0))
        await expect(
          p1RevenueTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])
        ).to.be.revertedWith('batch auctions not enabled')

        // Enable batch auctions (normal flow)
        await broker.connect(owner).setBatchAuctionLength(config.batchAuctionLength)

        await expect(
          p1RevenueTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])
        ).to.emit(rTokenTrader, 'TradeStarted')
      })

      it('Should be able to start a dust auction DUTCH_AUCTION, if enabled', async () => {
        const minTrade = bn('1e18')

        await rTokenTrader.connect(owner).setMinTradeVolume(minTrade)

        await collateral0.refresh()

        const dustAmount = bn('1e17')
        await token0.connect(addr1).transfer(rTokenTrader.address, dustAmount)

        const p1RevenueTrader = await ethers.getContractAt('RevenueTraderP1', rTokenTrader.address)

        // Disable dutch auctions, should not start auction
        await broker.connect(owner).setDutchAuctionLength(bn(0))
        await expect(
          p1RevenueTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
        ).to.be.revertedWith('dutch auctions not enabled')

        // Enable batch auctions (normal flow)
        await broker.connect(owner).setDutchAuctionLength(config.dutchAuctionLength)

        await expect(
          p1RevenueTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
        ).to.emit(rTokenTrader, 'TradeStarted')
      })

      it('Should be able to force through a dust BATCH auction but not DUTCH, if oracle has failed', async () => {
        const minTrade = bn('1e18')

        await rsrTrader.connect(owner).setMinTradeVolume(minTrade)

        const dustAmount = bn('1e17')
        await token0.connect(addr1).transfer(rsrTrader.address, dustAmount)

        await setOraclePrice(collateral0.address, bn(0))
        await collateral0.refresh()
        await advanceTime(PRICE_TIMEOUT.add(DECAY_DELAY).toString())
        await setOraclePrice(rsrAsset.address, bn('1e8'))

        const p = await collateral0.price()
        expect(p[0]).to.equal(0)
        expect(p[1]).to.equal(MAX_UINT192)
        await expect(
          rsrTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
        ).to.revertedWith('dutch auctions require live prices')
        await expect(rsrTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])).to.emit(
          rsrTrader,
          'TradeStarted'
        )

        expect(await token0.balanceOf(rsrTrader.address)).to.equal(0) // should sell entire balance
      })

      it('Should not launch an auction for 1 qTok', async () => {
        await token0.connect(addr1).transfer(rTokenTrader.address, 1)
        await expect(
          rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
        ).to.be.revertedWith('sell amount too low')
        await expect(
          rTokenTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])
        ).to.be.revertedWith('sell amount too low')
      })

      it('Should handle properly an asset with low maxTradeVolume', async () => {
        // Set f = 1
        await expect(
          distributor.connect(owner).setDistributions(
            [STRSR_DEST, FURNACE_DEST],
            [
              { rTokenDist: bn(0), rsrDist: bn(10000) },
              { rTokenDist: bn(0), rsrDist: bn(0) },
            ]
          )
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(0), bn(0))

        // Avoid dropping 20 qAAVE by making there be exactly 1 distribution share.
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(10000) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(10000))

        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1000e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Set new asset for AAVE with low maxTradeVolume
        const newAAVEAsset: Asset = <Asset>await AssetFactory.deploy(
          PRICE_TIMEOUT,
          await aaveAsset.chainlinkFeed(),
          ORACLE_ERROR,
          aaveToken.address,
          bn(606), // 2 qTok auction at $300 (after accounting for price.high)
          ORACLE_TIMEOUT
        )

        // Set a very high price
        const aavePrice = bn('300e8')
        await setOraclePrice(newAAVEAsset.address, aavePrice)

        // Refresh asset
        await newAAVEAsset.refresh()

        // Swap asset
        await assetRegistry.connect(owner).swapRegistered(newAAVEAsset.address)

        // Collect revenue
        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions - will sell the maxTradeVolume
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: true,
            args: [
              anyValue,
              aaveToken.address,
              rsr.address,
              bn(2),
              // the 1% increase here offsets the 1% decrease that would normally be applied to the sellAmt, but since 1 is the floor, isn't
              await toMinBuyAmt(bn(2), fp('303'), fp('1')),
            ],
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check funds now in Market
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(bn(2))
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(bn(0))
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(rewardAmountAAVE.sub(bn(2)))

        // Check destinations, nothing still -  Auctions need to be completed
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should handle GNOSIS_MAX_TOKENS cap in BATCH_AUCTION', async () => {
        // Halve price to trigger maxTradeSize() overflow
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('0.5e8'))
        )

        // Set Max trade volume very high for both assets in trade
        const newSellAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            PRICE_TIMEOUT,
            chainlinkFeed.address,
            ORACLE_ERROR,
            aaveToken.address,
            MAX_UINT192,
            ORACLE_TIMEOUT
          )
        )

        const newRSRAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            PRICE_TIMEOUT,
            await rsrAsset.chainlinkFeed(),
            ORACLE_ERROR,
            rsr.address,
            MAX_UINT192,
            ORACLE_TIMEOUT
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newSellAsset.address)
        await assetRegistry.connect(owner).swapRegistered(newRSRAsset.address)
        await basketHandler.refreshBasket()

        // Set rewards manually
        const amount = MAX_UINT192
        await aaveToken.connect(owner).mint(rsrTrader.address, amount)

        const p1RevenueTrader = await ethers.getContractAt('RevenueTraderP1', rsrTrader.address)

        await expect(
          p1RevenueTrader.manageTokens([aaveToken.address], [TradeKind.BATCH_AUCTION])
        ).to.emit(rsrTrader, 'TradeStarted')

        // Check trade is using the GNOSIS limits
        const trade = await getTrade(rsrTrader, aaveToken.address)
        expect(await trade.initBal()).to.equal(GNOSIS_MAX_TOKENS)
      })

      it('Should claim AAVE and handle revenue auction correctly - small amount processed in single auction', async () => {
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        // Can also claim through Facade
        await expectEvents(facadeTest.claimRewards(rToken.address), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(rewardAmountAAVE)

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check balances sent to corresponding destinations; won't be exact because distributor rounds
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(
          minBuyAmt,
          minBuyAmt.div(bn('1e13'))
        )
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          minBuyAmtRToken,
          minBuyAmtRToken.div(bn('1e13'))
        )
      })

      it('Should handle large auctions using maxTradeVolume with f=1 (RSR only)', async () => {
        // Set max trade volume for asset
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
        )
        const newAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            PRICE_TIMEOUT,
            chainlinkFeed.address,
            ORACLE_ERROR,
            aaveToken.address,
            fp('1'),
            ORACLE_TIMEOUT
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newAsset.address)
        await basketHandler.refreshBasket()

        // Set f = 1
        await expect(
          distributor.connect(owner).setDistributions(
            [STRSR_DEST, FURNACE_DEST],
            [
              { rTokenDist: bn(0), rsrDist: bn(10000) },
              { rTokenDist: bn(0), rsrDist: bn(0) },
            ]
          )
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(0), bn(0))

        // Avoid dropping 20 qAAVE by making there be exactly 1 distribution share.
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(10000) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(10000))

        // Set AAVE tokens as reward
        rewardAmountAAVE = fp('1.9')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)
        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Expected values based on Prices between AAVE and RSR = 1 to 1 (for simplification)
        const sellAmt: BigNumber = fp('1').mul(100).div(101) // due to high price setting trade size
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Check funds in Market and Trader
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(sellAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(rewardAmountAAVE.sub(sellAmt))

        // Another call will not create a new auction (we only allow only one at a time per pair)
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Perform Mock Bids for RSR (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions
        const remainderSellAmt = rewardAmountAAVE.sub(sellAmt)
        const remainderMinBuyAmt = await toMinBuyAmt(remainderSellAmt, fp('1'), fp('1'))
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rsr.address,
              remainderSellAmt,
              withinTolerance(remainderMinBuyAmt),
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check new auction
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check now all funds in Market
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(remainderSellAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)

        // Perform Mock Bids for RSR (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, remainderMinBuyAmt)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: remainderSellAmt,
          buyAmount: remainderMinBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, remainderSellAmt, remainderMinBuyAmt],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        //  Check balances sent to corresponding destinations
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(
          minBuyAmt.add(remainderMinBuyAmt),
          10000
        )
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should handle large auctions using maxTradeVolume with f=0 (RToken only)', async () => {
        // Set max trade volume for asset
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
        )
        const newAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            PRICE_TIMEOUT,
            chainlinkFeed.address,
            ORACLE_ERROR,
            aaveToken.address,
            fp('1'),
            ORACLE_TIMEOUT
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newAsset.address)
        await basketHandler.refreshBasket()

        // Set f = 0, avoid dropping tokens

        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(10000), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(10000), bn(0))

        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(0))

        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RToken = 1 (for simplification)
        const sellAmt: BigNumber = fp('1').mul(100).div(101) // due to high price setting trade size
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmt,
              withinTolerance(minBuyAmt),
            ],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Calculate pending amount
        const sellAmtRemainder: BigNumber = rewardAmountAAVE.sub(sellAmt)
        const minBuyAmtRemainder: BigNumber = await toMinBuyAmt(sellAmtRemainder, fp('1'), fp('1'))

        // Check funds in Market and Trader
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(sellAmt)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(sellAmtRemainder)

        // Perform Mock Bids for RToken (addr1 has balance)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Another call will create a new auction and close existing
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rToken.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRemainder,
              withinTolerance(minBuyAmtRemainder),
            ],
            emitted: true,
          },

          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check new auction
        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Perform Mock Bids for RToken (addr1 has balance)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRemainder)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Close auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRemainder,
              minBuyAmtRemainder,
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check balances in destinations
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          minBuyAmt.add(minBuyAmtRemainder),
          minBuyAmt.add(minBuyAmtRemainder).div(bn('1e3')) // melting
        )
      })

      it('Should handle large auctions using maxTradeVolume with revenue split RSR/RToken', async () => {
        // Set max trade volume for asset
        const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
        )
        const newAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            PRICE_TIMEOUT,
            chainlinkFeed.address,
            ORACLE_ERROR,
            aaveToken.address,
            fp('1'),
            ORACLE_TIMEOUT
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newAsset.address)
        await basketHandler.refreshBasket()

        // Set f = 0.8 (0.2 for Rtoken)
        await expect(
          distributor.connect(owner).setDistributions(
            [STRSR_DEST, FURNACE_DEST],
            [
              { rTokenDist: bn(0), rsrDist: bn(8000) },
              { rTokenDist: bn(2000), rsrDist: bn(0) },
            ]
          )
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(2000), bn(0))

        // Set AAVE tokens as reward
        // Based on current f -> 1.6e18 to RSR and 0.4e18 to Rtoken
        rewardAmountAAVE = bn('2e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = fp('1').mul(100).div(101) // due to high price setting trade size
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountAAVE.mul(20).div(100) // All Rtokens can be sold - 20% of total comp based on f
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Advance time till auctions ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        // Calculate pending amount
        const sellAmtRemainder: BigNumber = rewardAmountAAVE.sub(sellAmt).sub(sellAmtRToken)
        const minBuyAmtRemainder: BigNumber = await toMinBuyAmt(sellAmtRemainder, fp('1'), fp('1'))

        // Check funds in Market and Traders
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(sellAmt.add(sellAmtRToken))
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(sellAmtRemainder)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rsr.address,
              sellAmtRemainder,
              withinTolerance(minBuyAmtRemainder),
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check destinations at this stage
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(minBuyAmt, 10000)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(minBuyAmtRToken, 10000)

        // Run final auction until all funds are converted
        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmtRemainder)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check balances at destinations
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(
          minBuyAmt.add(minBuyAmtRemainder),
          10000
        )
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          minBuyAmtRToken,
          minBuyAmtRToken.div(bn('1e2'))
        )
      })

      it('Should only allow RevenueTraders to call distribute()', async () => {
        const distAmount: BigNumber = bn('100e18')

        // Set f = 1
        await expect(
          distributor.connect(owner).setDistributions(
            [STRSR_DEST, FURNACE_DEST],
            [
              { rTokenDist: bn(0), rsrDist: bn(10000) },
              { rTokenDist: bn(0), rsrDist: bn(0) },
            ]
          )
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(0), bn(0))
        // Avoid dropping 20 qCOMP by making there be exactly 1 distribution share.
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(10000) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(10000))

        // Transfer some RSR to RevenueTraders
        await rsr.connect(addr1).transfer(rTokenTrader.address, distAmount)
        await rsr.connect(addr1).transfer(rsrTrader.address, distAmount)

        // Check funds in RevenueTraders and destinations
        expect(await rsr.balanceOf(rTokenTrader.address)).to.equal(distAmount)
        expect(await rsr.balanceOf(rsrTrader.address)).to.equal(distAmount)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Try and fail to distribute the RSR from random account and BackingManager
        await expect(
          distributor.connect(owner).distribute(rsr.address, distAmount)
        ).to.be.revertedWith('RevenueTraders only')
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await rsr.connect(bmSigner).approve(distributor.address, distAmount)

          await expect(
            distributor.connect(bmSigner).distribute(rsr.address, distAmount)
          ).to.be.revertedWith('RevenueTraders only')
        })

        // Should succeed for RevenueTraders
        await whileImpersonating(rTokenTrader.address, async (bmSigner) => {
          await rsr.connect(bmSigner).approve(distributor.address, distAmount)
          await distributor.connect(bmSigner).distribute(rsr.address, distAmount)
        })
        await whileImpersonating(rsrTrader.address, async (bmSigner) => {
          await rsr.connect(bmSigner).approve(distributor.address, distAmount)
          await distributor.connect(bmSigner).distribute(rsr.address, distAmount)
        })

        // RSR should be in staking pool
        expect(await rsr.balanceOf(stRSR.address)).to.equal(distAmount.mul(2))
      })

      it('Should revert if no distribution exists for a specific token', async () => {
        // Check funds in Backing Manager and destinations
        expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set f = 0, avoid dropping tokens
        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(10000), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(10000), bn(0))
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(0))

        await whileImpersonating(rTokenTrader.address, async (bmSigner) => {
          await expect(
            distributor.connect(bmSigner).distribute(rsr.address, bn(100))
          ).to.be.revertedWith('nothing to distribute')
        })

        //  Check funds, nothing changed
        expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should handle no distribution defined when settling trade', async () => {
        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountCOMP.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, bn(0)],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, compToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              compToken.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: compToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await compToken.balanceOf(gnosis.address)).to.equal(rewardAmountCOMP)

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Set no distribution for StRSR
        // Set f = 0, avoid dropping tokens
        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(10000), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(10000), bn(0))
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(0))

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check balances
        // StRSR - Still in trader, was not distributed due to zero distribution
        expect(await rsr.balanceOf(rsrTrader.address)).to.equal(minBuyAmt)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(bn(0))

        // Furnace - RTokens transferred to destination
        expect(await rToken.balanceOf(rTokenTrader.address)).to.closeTo(bn(0), 10000)
        expect(await rToken.balanceOf(furnace.address)).to.closeTo(
          minBuyAmtRToken,
          minBuyAmtRToken.div(bn('1e13'))
        )
      })

      it('Should allow to settle trade (and not distribute) even if trading paused or frozen', async () => {
        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountCOMP.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, bn(0)],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, compToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              compToken.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: compToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await compToken.balanceOf(gnosis.address)).to.equal(rewardAmountCOMP)

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Pause Trading
        await main.connect(owner).pauseTrading()

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Distribution did not occurr, funds are in Traders
        expect(await rsr.balanceOf(rsrTrader.address)).to.equal(minBuyAmt)
        expect(await rToken.balanceOf(rTokenTrader.address)).to.equal(minBuyAmtRToken)

        expect(await rsr.balanceOf(stRSR.address)).to.equal(bn(0))
        expect(await rToken.balanceOf(furnace.address)).to.equal(bn(0))
      })

      it('Should trade even if price for buy token = 0', async () => {
        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)

        // Set expected values, based on f = 0.6
        const expectedToTrader = rewardAmountAAVE.mul(6000).div(10000)
        const expectedToFurnace = rewardAmountAAVE.sub(expectedToTrader)

        // Check status of traders at this point
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Handout AAVE tokens to Traders
        await backingManager.forwardRevenue([aaveToken.address])

        // Check funds sent to traders
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(expectedToTrader)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(expectedToFurnace)

        // Set RSR price to 0
        await setOraclePrice(rsrAsset.address, bn('0'))

        // Should not revert
        await expect(rsrTrader.manageTokens([aaveToken.address], [TradeKind.BATCH_AUCTION])).to.not
          .be.reverted

        // Trade open for aaveToken
        const t = await getTrade(rsrTrader, aaveToken.address)
        expect(t.address).to.not.equal(ZERO_ADDRESS)
      })

      it('Should report violation when Batch Auction behaves incorrectly', async () => {
        // This test needs to be in this file and not Broker.test.ts because settleTrade()
        // requires the BackingManager _actually_ started the trade

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        // Claim rewards

        await expectEvents(facadeTest.claimRewards(rToken.address), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        // In order to force deactivation we provide an amount below minBuyAmt, this will represent for our tests an invalid behavior although in a real scenario would retrigger auction
        // NOTE: DIFFERENT BEHAVIOR WILL BE OBSERVED ON PRODUCTION GNOSIS AUCTIONS
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt.sub(10), // Forces in our mock an invalid behavior
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken.sub(10), // Forces in our mock an invalid behavior
        })

        // Close auctions - Will end trades and also report violation
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: broker,
            name: 'BatchTradeDisabledSet',
            args: [false, true],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt.sub(10)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRToken,
              minBuyAmtRToken.sub(10),
            ],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check broker disabled (batch)
        expect(await broker.batchTradeDisabled()).to.equal(true)

        // Check funds at destinations
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(minBuyAmt.sub(10), 5000)
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(minBuyAmtRToken.sub(10), 5000)
      })

      it('Should report violation even if paused or frozen', async () => {
        // This test needs to be in this file and not Broker.test.ts because settleTrade()
        // requires the BackingManager _actually_ started the trade

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        // Claim rewards
        await facadeTest.claimRewards(rToken.address)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        // In order to force deactivation we provide an amount below minBuyAmt, this will represent for our tests an invalid behavior although in a real scenario would retrigger auction
        // NOTE: DIFFERENT BEHAVIOR WILL BE OBSERVED ON PRODUCTION GNOSIS AUCTIONS
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt.sub(10), // Forces in our mock an invalid behavior
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken.sub(10), // Forces in our mock an invalid behavior
        })

        // Freeze protocol
        await main.connect(owner).freezeShort()

        // Close auctions - Will end trades and also report violation
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: broker,
            name: 'BatchTradeDisabledSet',
            args: [false, true],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt.sub(10)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRToken,
              minBuyAmtRToken.sub(10),
            ],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check broker disabled (batch)
        expect(await broker.batchTradeDisabled()).to.equal(true)

        // Funds are not distributed if paused or frozen
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rsr.balanceOf(rsrTrader.address)).to.be.closeTo(minBuyAmt.sub(10), 50)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await rToken.balanceOf(rTokenTrader.address)).to.be.closeTo(
          minBuyAmtRToken.sub(10),
          50
        )
      })

      it('Should not report violation when Dutch Auction clears in geometric phase', async () => {
        // This test needs to be in this file and not Broker.test.ts because settleTrade()
        // requires the BackingManager _actually_ started the trade
        const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
        await rsr.connect(addr1).approve(router.address, constants.MaxUint256)
        await rToken.connect(addr1).approve(router.address, constants.MaxUint256)
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        // Claim rewards

        await expectEvents(facadeTest.claimRewards(rToken.address), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions
        await expectEvents(
          facadeTest.runAuctionsForAllTradersForKind(rToken.address, TradeKind.DUTCH_AUCTION),
          [
            {
              contract: rsrTrader,
              name: 'TradeStarted',
              args: [anyValue, aaveToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
              emitted: true,
            },
            {
              contract: rTokenTrader,
              name: 'TradeStarted',
              args: [
                anyValue,
                aaveToken.address,
                rToken.address,
                sellAmtRToken,
                withinTolerance(minBuyAmtRToken),
              ],
              emitted: true,
            },
          ]
        )

        // Check auctions registered
        // AAVE -> RSR Auction
        const rsrTrade = await ethers.getContractAt(
          'DutchTrade',
          (
            await getTrade(rsrTrader, aaveToken.address)
          ).address
        )
        expect(await rsrTrade.sell()).to.equal(aaveToken.address)
        expect(await rsrTrade.buy()).to.equal(rsr.address)
        expect(await rsrTrade.sellAmount()).to.equal(sellAmt)

        // AAVE -> RToken Auction
        const rTokenTrade = await ethers.getContractAt(
          'DutchTrade',
          (
            await getTrade(rTokenTrader, aaveToken.address)
          ).address
        )
        expect(await rTokenTrade.sell()).to.equal(aaveToken.address)
        expect(await rTokenTrade.buy()).to.equal(rToken.address)
        expect(await rTokenTrade.sellAmount()).to.equal(sellAmtRToken)

        // Should not be disabled to start
        expect(await broker.dutchTradeDisabled(aaveToken.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rsr.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rToken.address)).to.equal(false)

        // Advance time near end of geometric phase
        await advanceToTimestamp(
          (await rTokenTrade.startTime()) + config.dutchAuctionLength.div(5).sub(6).toNumber()
        )

        // Should settle RSR auction without disabling dutch auctions
        await expect(router.connect(addr1).bid(rsrTrade.address, addr1.address))
          .to.emit(rsrTrader, 'TradeSettled')
          .withArgs(anyValue, aaveToken.address, rsr.address, sellAmt, anyValue)

        expect(await broker.dutchTradeDisabled(aaveToken.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rsr.address)).to.equal(false)

        // Should still be able to settle RToken auction
        await expect(router.connect(addr1).bid(rTokenTrade.address, addr1.address))
          .to.emit(rTokenTrader, 'TradeSettled')
          .withArgs(anyValue, aaveToken.address, rToken.address, sellAmtRToken, anyValue)

        // Check all no tokens are disabled for dutch auctions
        expect(await broker.dutchTradeDisabled(aaveToken.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rsr.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rToken.address)).to.equal(false)
      })

      it('Should not report violation when Dutch Auction clears in first linear phase', async () => {
        // This test needs to be in this file and not Broker.test.ts because settleTrade()
        // requires the BackingManager _actually_ started the trade
        const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
        await rsr.connect(addr1).approve(router.address, constants.MaxUint256)
        await rToken.connect(addr1).approve(router.address, constants.MaxUint256)
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        // Claim rewards

        await expectEvents(facadeTest.claimRewards(rToken.address), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions
        await expectEvents(
          facadeTest.runAuctionsForAllTradersForKind(rToken.address, TradeKind.DUTCH_AUCTION),
          [
            {
              contract: rsrTrader,
              name: 'TradeStarted',
              args: [anyValue, aaveToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
              emitted: true,
            },
            {
              contract: rTokenTrader,
              name: 'TradeStarted',
              args: [
                anyValue,
                aaveToken.address,
                rToken.address,
                sellAmtRToken,
                withinTolerance(minBuyAmtRToken),
              ],
              emitted: true,
            },
          ]
        )

        // Check auctions registered
        // AAVE -> RSR Auction
        const rsrTrade = await ethers.getContractAt(
          'DutchTrade',
          (
            await getTrade(rsrTrader, aaveToken.address)
          ).address
        )
        expect(await rsrTrade.sell()).to.equal(aaveToken.address)
        expect(await rsrTrade.buy()).to.equal(rsr.address)
        expect(await rsrTrade.sellAmount()).to.equal(sellAmt)

        // AAVE -> RToken Auction
        const rTokenTrade = await ethers.getContractAt(
          'DutchTrade',
          (
            await getTrade(rTokenTrader, aaveToken.address)
          ).address
        )
        expect(await rTokenTrade.sell()).to.equal(aaveToken.address)
        expect(await rTokenTrade.buy()).to.equal(rToken.address)
        expect(await rTokenTrade.sellAmount()).to.equal(sellAmtRToken)

        // Should not be disabled to start
        expect(await broker.dutchTradeDisabled(aaveToken.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rsr.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rToken.address)).to.equal(false)

        // Advance time to middle of first linear phase
        await advanceToTimestamp(
          (await rTokenTrade.startTime()) + config.dutchAuctionLength.div(3).toNumber()
        )

        // Should settle RSR auction
        await expect(router.connect(addr1).bid(rsrTrade.address, addr1.address))
          .to.emit(rsrTrader, 'TradeSettled')
          .withArgs(anyValue, aaveToken.address, rsr.address, sellAmt, anyValue)

        // Should settle RToken auction
        await expect(router.connect(addr1).bid(rTokenTrade.address, addr1.address))
          .to.emit(rTokenTrader, 'TradeSettled')
          .withArgs(anyValue, aaveToken.address, rToken.address, sellAmtRToken, anyValue)

        // Should not have disabled anything
        expect(await broker.dutchTradeDisabled(aaveToken.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rsr.address)).to.equal(false)
        expect(await broker.dutchTradeDisabled(rToken.address)).to.equal(false)
      })

      it('Should not perform auction if Batch Trades are disabled', async () => {
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Claim rewards
        await expectEvents(facadeTest.claimRewards(rToken.address), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations and traders
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Disable broker
        await disableBatchTrade()

        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(6000).div(10000) // due to f = 6000%
        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder

        // Attempt to run auctions
        await backingManager.forwardRevenue([aaveToken.address])
        await expect(
          rsrTrader.manageTokens([aaveToken.address], [TradeKind.BATCH_AUCTION])
        ).to.be.revertedWith('batch auctions disabled')
        await expect(
          rTokenTrader.manageTokens([aaveToken.address], [TradeKind.BATCH_AUCTION])
        ).to.be.revertedWith('batch auctions disabled')

        // Check funds - remain in traders
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(sellAmt)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(sellAmtRToken)
      })

      it('Should not distribute other tokens beyond RSR/RToken', async () => {
        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check funds in Backing Manager and destinations
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Attempt to distribute AAVE token
        await whileImpersonating(rTokenTrader.address, async (signer) => {
          await expect(
            distributor.connect(signer).distribute(aaveToken.address, rewardAmountAAVE)
          ).to.be.revertedWith('RSR or RToken')
        })
        //  Check nothing changed
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should handle custom destinations correctly', async () => {
        // Set distribution - 50% of each to another account
        await expect(
          distributor
            .connect(owner)
            .setDistribution(other.address, { rTokenDist: bn(4000), rsrDist: bn(6000) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(other.address, bn(4000), bn(6000))

        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(6000).div(10000) // due to f = 6000%
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rsr.balanceOf(other.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await rToken.balanceOf(other.address)).to.equal(0)

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(rewardAmountAAVE)

        // Advance time till auctions ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check balances sent to corresponding destinations
        // StRSR - 50% to StRSR, 50% to other
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(
          minBuyAmt.div(2),
          minBuyAmt.div(2).div(bn('1e13'))
        )
        expect(await rsr.balanceOf(other.address)).to.be.closeTo(
          minBuyAmt.div(2),
          minBuyAmt.div(2).div(bn('1e13'))
        )

        // Furnace - 50% to Furnace, 50% to other
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          minBuyAmtRToken.div(2),
          minBuyAmtRToken.div(2).div(bn('1e13'))
        )
        expect(await rToken.balanceOf(other.address)).to.be.closeTo(
          minBuyAmtRToken.div(2),
          minBuyAmtRToken.div(2).div(bn('1e13'))
        )
      })

      it('Should support custom destinations only', async () => {
        // Set distribution all to a custom destination
        await expect(
          distributor
            .connect(owner)
            .setDistribution(other.address, { rTokenDist: bn(0), rsrDist: bn(10000) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(other.address, bn(0), bn(10000))

        // No distribution to Furnace or StRSR
        await expect(
          distributor.connect(owner).setDistributions(
            [other.address, STRSR_DEST, FURNACE_DEST],
            [
              { rTokenDist: bn(0), rsrDist: bn(10000) },
              { rTokenDist: bn(0), rsrDist: bn(0) },
              { rTokenDist: bn(0), rsrDist: bn(0) },
            ]
          )
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(0), bn(0))

        const rsrBalInDestination = await rsr.balanceOf(other.address)
        await rsr.connect(owner).mint(rsrTrader.address, issueAmount)
        await rsrTrader.distributeTokenToBuy()
        const expectedAmount = rsrBalInDestination.add(issueAmount)
        expect(await rsr.balanceOf(other.address)).to.be.closeTo(expectedAmount, 10000)
      })

      it('Should claim but not sweep rewards to BackingManager from the Revenue Traders', async () => {
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(rsrTrader.address, rewardAmountAAVE)

        // Check balance in main and Traders
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)

        // Collect revenue
        await expectEvents(rsrTrader.claimRewards(), [
          {
            contract: rsrTrader,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check rewards were not sent to Main
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(rewardAmountAAVE)
      })

      it('Should claim properly from multiple assets with the same Reward token', async () => {
        // Get aUSDT and register
        const newToken: StaticATokenMock = <StaticATokenMock>erc20s[9]
        const newATokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>collateral[9]
        await assetRegistry.connect(owner).register(newATokenCollateral.address)

        // Setup new basket with two ATokens (same reward token)
        await basketHandler
          .connect(owner)
          .setPrimeBasket([token2.address, newToken.address], [fp('0.5'), fp('0.5')])

        // Switch basket
        await basketHandler.connect(owner).refreshBasket()

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)
        await newToken.setRewards(backingManager.address, rewardAmountAAVE.add(1))

        // Claim and sweep rewards
        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
          {
            contract: newToken,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE.add(1)],
            emitted: true,
          },
        ])

        // Check status - should claim both rewards correctly
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(
          rewardAmountAAVE.mul(2).add(1)
        )
      })

      it('Should be able to claimRewardsSingle to escape reverting claimRewards()', async () => {
        // Here the aToken is going to have an invalid claimRewards on its asset

        // cToken
        rewardAmountCOMP = bn('0.5e18')
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Setup a new aToken with invalid claim data
        const ATokenCollateralFactory = await ethers.getContractFactory(
          'InvalidATokenFiatCollateralMock'
        )
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
        )

        const invalidATokenCollateral: InvalidATokenFiatCollateralMock = <
          InvalidATokenFiatCollateralMock
        >((await ATokenCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: chainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: token2.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold: fp('0.05'),
            delayUntilDefault: await collateral2.delayUntilDefault(),
          },
          REVENUE_HIDING
        )) as unknown)

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(invalidATokenCollateral.address)

        // Setup new basket with the invalid AToken
        await basketHandler.connect(owner).setPrimeBasket([token2.address], [fp('1')])

        // Switch basket
        await basketHandler.connect(owner).refreshBasket()

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Claim and sweep rewards -- fails
        await expect(backingManager.claimRewards()).to.be.reverted

        // But can claimRewardsSingle
        await expect(backingManager.claimRewardsSingle(token3.address)).to.emit(
          backingManager,
          'RewardsClaimed'
        )
      })

      context('DutchTrade', () => {
        const auctionLength = 1800 // 30 minutes
        beforeEach(async () => {
          await broker.connect(owner).setDutchAuctionLength(auctionLength)
        })

        it('Should not trade when paused', async () => {
          await main.connect(owner).pauseTrading()
          await expect(
            rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
          ).to.be.revertedWith('frozen or trading paused')
        })

        it('Should not trade when frozen', async () => {
          await main.connect(owner).freezeLong()
          await expect(
            rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
          ).to.be.revertedWith('frozen or trading paused')
        })

        it('Should trade if issuance paused', async () => {
          await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
          await main.connect(owner).pauseIssuance()
          await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
        })

        it('Should only run 1 trade per ERC20 at a time', async () => {
          await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
          await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
          await expect(
            rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
          ).to.be.revertedWith('trade open')
          await expect(
            rTokenTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])
          ).to.be.revertedWith('trade open')

          // Other ERC20 should be able to open trade
          await token1.connect(addr1).transfer(rTokenTrader.address, issueAmount)
          await rTokenTrader.manageTokens([token1.address], [TradeKind.DUTCH_AUCTION])
        })

        it('Should not return bid amount before auction starts', async () => {
          await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
          await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])

          const trade = await ethers.getContractAt(
            'DutchTrade',
            await rTokenTrader.trades(token0.address)
          )

          // Cannot get bid amount yet
          await expect(
            trade.connect(addr1).bidAmount(await getLatestBlockTimestamp())
          ).to.be.revertedWith('auction not started')

          // Can get bid amount in following block
          await advanceToTimestamp((await getLatestBlockTimestamp()) + 12)
          const actual = await trade.connect(addr1).bidAmount(await getLatestBlockTimestamp())
          expect(actual).to.be.gt(bn(0))
        })

        // Run test for both bid types
        const bidTypes = [BidType.CALLBACK, BidType.TRANSFER]
        bidTypes.forEach((bidType) => {
          it(`Should allow one bidder - Bid Type: ${Object.values(BidType)[bidType]}`, async () => {
            const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
            await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount.div(2000))
            await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])

            const trade = await ethers.getContractAt(
              'DutchTrade',
              await rTokenTrader.trades(token0.address)
            )

            // Bid
            if (bidType == BidType.CALLBACK) {
              await (await ethers.getContractAt('ERC20Mock', await trade.buy()))
                .connect(addr1)
                .approve(router.address, constants.MaxUint256)

              await router.connect(addr1).bid(trade.address, addr1.address)
              expect(await trade.bidder()).to.equal(router.address)

              // Noone can bid again on the trade directly
              await expect(
                trade.connect(addr1).bidWithCallback(new Uint8Array(0))
              ).to.be.revertedWith('bid already received')

              // Cannot bid once is settled via router
              await expect(
                router.connect(addr1).bid(trade.address, addr1.address)
              ).to.be.revertedWith('trade not open')
            }

            if (bidType == BidType.TRANSFER) {
              await (await ethers.getContractAt('ERC20Mock', await trade.buy()))
                .connect(addr1)
                .approve(trade.address, constants.MaxUint256)

              await trade.connect(addr1).bid()
              expect(await trade.bidder()).to.equal(addr1.address)
              // Cannot bid once is settled
              await expect(trade.connect(addr1).bid()).to.be.revertedWith('bid already received')
            }
          })
        })

        it('Trade should initially have bidType 0', async () => {
          await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount.div(2000))
          await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])

          const trade = await ethers.getContractAt(
            'DutchTrade',
            await rTokenTrader.trades(token0.address)
          )
          expect(await trade.bidType()).to.be.eq(0)
        })

        it('It should support non callback bid and perform validations', async () => {
          await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount.div(2000))
          await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])

          const trade = await ethers.getContractAt(
            'DutchTrade',
            await rTokenTrader.trades(token0.address)
          )

          await (await ethers.getContractAt('ERC20Mock', await trade.buy()))
            .connect(addr1)
            .approve(trade.address, constants.MaxUint256)

          // Bid
          await trade.connect(addr1).bid()
          expect(await trade.bidType()).to.be.eq(2)
          expect(await trade.bidder()).to.equal(addr1.address)

          // Should allow one bidder
          await expect(trade.connect(addr1).bid()).to.be.revertedWith('bid already received')
        })

        /// Tests callback based bidding
        describe('Callback based bidding', () => {
          it('Supports bidCb', async () => {
            await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount.div(2000))
            await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])

            const trade = await ethers.getContractAt(
              'DutchTrade',
              await rTokenTrader.trades(token0.address)
            )

            // Bid
            const bidder = await (
              await ethers.getContractFactory('CallbackDutchTraderBidder')
            ).deploy()
            await rToken.connect(addr1).transfer(bidder.address, issueAmount)
            await bidder.connect(addr1).bid(trade.address)
            expect(await trade.bidType()).to.be.eq(1)
            expect(await trade.bidder()).to.equal(bidder.address)
            expect(await trade.status()).to.be.eq(2) // Status.CLOSED
          })

          it('Will revert if bidder submits the wrong bid', async () => {
            await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount.div(2000))
            await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])

            const trade = await ethers.getContractAt(
              'DutchTrade',
              await rTokenTrader.trades(token0.address)
            )

            // Bid
            const bidder = await (
              await ethers.getContractFactory('CallbackDutchTraderBidderLowBaller')
            ).deploy()
            await rToken.connect(addr1).transfer(bidder.address, issueAmount)
            await expect(bidder.connect(addr1).bid(trade.address)).to.be.revertedWith(
              'insufficient buy tokens'
            )

            expect(await trade.bidder()).to.equal(constants.AddressZero)
            expect(await trade.status()).to.be.eq(1) // Status.OPEN
          })

          it('Will revert if bidder submits no bid', async () => {
            await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount.div(2000))
            await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])

            const trade = await ethers.getContractAt(
              'DutchTrade',
              await rTokenTrader.trades(token0.address)
            )

            // Bid
            const bidder = await (
              await ethers.getContractFactory('CallbackDutchTraderBidderNoPayer')
            ).deploy()
            await rToken.connect(addr1).transfer(bidder.address, issueAmount)
            await expect(bidder.connect(addr1).bid(trade.address)).to.be.revertedWith(
              'insufficient buy tokens'
            )

            expect(await trade.bidder()).to.equal(constants.AddressZero)
            expect(await trade.status()).to.be.eq(1) // Status.OPEN
          })
        })

        it('Should quote piecewise-falling price correctly throughout entirety of auction', async () => {
          issueAmount = issueAmount.div(10000)
          const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()

          await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
          await rToken.connect(addr1).approve(router.address, constants.MaxUint256)
          await token0.connect(addr1).approve(router.address, constants.MaxUint256)
          await token1.connect(addr1).approve(router.address, constants.MaxUint256)
          await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
          const trade = await ethers.getContractAt(
            'DutchTrade',
            await rTokenTrader.trades(token0.address)
          )

          const start = await trade.startTime()
          const end = await trade.endTime()

          await advanceToTimestamp(start)
          let now = start
          while (now < end) {
            const actual = await trade.connect(addr1).bidAmount(now)
            const expected = await dutchBuyAmount(
              fp(now - start).div(end - start),
              rTokenAsset.address,
              collateral0.address,
              issueAmount,
              config.maxTradeSlippage
            )
            expect(actual).to.be.closeTo(expected, expected.div(bn('1e13')))

            const staticResult = await router
              .connect(addr1)
              .callStatic.bid(trade.address, addr1.address)
            expect(staticResult.buyAmt).to.equal(actual)
            await advanceToTimestamp(now + 12)
            now = await getLatestBlockTimestamp()
          }
        })

        // Perform test for both Bid Types
        bidTypes.forEach((bidType) => {
          it(`Should handle no bid case correctly - Bid Type: ${
            Object.values(BidType)[bidType]
          }`, async () => {
            await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
            await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
            const trade = await ethers.getContractAt(
              'DutchTrade',
              await rTokenTrader.trades(token0.address)
            )

            await advanceToTimestamp((await trade.endTime()) + 1)
            await expect(
              trade.connect(addr1).bidAmount(await getLatestBlockTimestamp())
            ).to.be.revertedWith('auction over')

            // Bid
            if (bidType == BidType.CALLBACK) {
              const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
              await expect(router.connect(addr1).bid(trade.address, addr1.address)).be.revertedWith(
                'auction over'
              )
            } else if (bidType == BidType.TRANSFER) {
              await expect(trade.connect(addr1).bid()).be.revertedWith('auction over')
            }

            // Should be able to settle
            await expect(trade.settle()).to.be.revertedWith('only origin can settle')
            await expect(rTokenTrader.settleTrade(token0.address))
              .to.emit(rTokenTrader, 'TradeSettled')
              .withArgs(trade.address, token0.address, rToken.address, 0, 0)

            // Should NOT start another auction, since caller was not DutchTrade
            expect(await backingManager.tradesOpen()).to.equal(0)
          })
        })

        // Perform test for both bid types
        bidTypes.forEach((bidType) => {
          it(`Should bid at exactly endTime() and not launch another auction - Bid Type: ${
            Object.values(BidType)[bidType]
          }`, async () => {
            const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
            await rToken.connect(addr1).approve(router.address, constants.MaxUint256)
            await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
            await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
            const trade = await ethers.getContractAt(
              'DutchTrade',
              await rTokenTrader.trades(token0.address)
            )
            await rToken.connect(addr1).approve(trade.address, constants.MaxUint256)
            await expect(trade.bidAmount(await trade.endTime())).to.not.be.reverted

            // Snipe auction at 0s left
            await advanceToTimestamp((await trade.endTime()) - 1)

            // Bid
            if (bidType == BidType.CALLBACK) {
              await router.connect(addr1).bid(trade.address, addr1.address)
              expect(await trade.bidder()).to.equal(router.address)
            } else if (bidType == BidType.TRANSFER) {
              await trade.connect(addr1).bid()
              expect(await trade.bidder()).to.equal(addr1.address)
            }

            expect(await trade.canSettle()).to.equal(false)
            expect(await trade.status()).to.equal(2) // Status.CLOSED
            expect(await token0.balanceOf(addr1.address)).to.equal(
              initialBal.sub(issueAmount.div(4))
            )

            const expected = await dutchBuyAmount(
              fp(auctionLength).div(auctionLength), // last possible second
              rTokenAsset.address,
              collateral0.address,
              issueAmount,
              config.maxTradeSlippage
            )
            expect(await rTokenTrader.tradesOpen()).to.equal(0)
            expect(await rToken.balanceOf(rTokenTrader.address)).to.be.closeTo(0, 10000)
            expect(await rToken.balanceOf(furnace.address)).to.equal(expected)
          })
        })

        it('Should return lot() in {qSellTok} and sellAmount() in {sellTok}', async () => {
          const amt = bn('1e6')
          await token1.connect(addr1).transfer(rTokenTrader.address, amt)
          await rTokenTrader.manageTokens([token1.address], [TradeKind.DUTCH_AUCTION])
          const trade = await ethers.getContractAt(
            'DutchTrade',
            await rTokenTrader.trades(token1.address)
          )
          expect(await trade.lot()).to.equal(amt)
          expect(await trade.sellAmount()).to.equal(amt.mul(bn('1e12')))
        })

        it('DutchTrade Reentrance Check', async () => {
          const exploiter = await (
            await ethers.getContractFactory('DutchTradeCallbackReentrantTest')
          ).deploy()

          await rToken.connect(addr1).approve(exploiter.address, constants.MaxUint256)
          await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
          await rTokenTrader.manageTokens([token0.address], [TradeKind.DUTCH_AUCTION])
          const trade = await ethers.getContractAt(
            'DutchTrade',
            await rTokenTrader.trades(token0.address)
          )
          await rToken.connect(addr1).approve(trade.address, constants.MaxUint256)
          await expect(trade.bidAmount(await trade.endTime())).to.not.be.reverted

          // Snipe auction at 0s left
          await advanceToTimestamp((await trade.endTime()) - 1)

          // Run it down
          await expect(exploiter.connect(addr1).start(trade.address, rTokenTrader.address)).to.be
            .reverted
        })
      })
    })

    context('With simple basket of ATokens and CTokens', function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Setup new basket with ATokens and CTokens
        await basketHandler
          .connect(owner)
          .setPrimeBasket([token2.address, token3.address], [fp('0.5'), fp('0.5')])
        await basketHandler.connect(owner).refreshBasket()

        // Provide approvals
        await token2.connect(addr1).approve(rToken.address, initialBal)
        await token3.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should sell collateral as it appreciates and handle revenue auction correctly', async () => {
        // Check Price and Assets value
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate for AToken to double
        await token2.setExchangeRate(fp('2'))
        await collateral2.refresh()

        // Check Price (unchanged) and Assets value increment by 50%
        const excessValue: BigNumber = issueAmount.div(2)
        const excessQuantity: BigNumber = excessValue.div(2) // Because each unit is now worth $2
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessValue)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Expected values
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const expectedToTrader = excessQuantity.mul(6000).div(10000)
        const expectedToFurnace = excessQuantity.sub(expectedToTrader)

        const sellAmt: BigNumber = expectedToTrader // everything is auctioned, below max auction
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('2'), fp('1'))
        const sellAmtRToken: BigNumber = expectedToFurnace // everything is auctioned, below max auction
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('2'), fp('1'))

        // Run auctions - Will detect excess
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, token2.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              token2.address,
              rToken.address,
              sellAmtRToken,
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (restored) - Supply remains constant
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // AToken -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: token2.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market and Traders
        expect(await token2.balanceOf(gnosis.address)).to.equal(sellAmt.add(sellAmtRToken))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToFurnace.sub(sellAmtRToken)
        )

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check Price (unchanged) and Assets value (unchanged)
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage - RSR and RTokens already in StRSR and Furnace
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(
          minBuyAmt,
          minBuyAmt.div(bn('1e13'))
        )
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          minBuyAmtRToken,
          minBuyAmtRToken.div(bn('1e13'))
        )

        // Check no more funds in Market and Traders
        expect(await token2.balanceOf(gnosis.address)).to.equal(0)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)
      })

      it('Should handle slight increase in collateral correctly - full cycle', async () => {
        // Check Price and Assets value
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate for AToken by 2%
        const rate: BigNumber = fp('1.02')
        await token2.setExchangeRate(rate)

        // Check Price (unchanged) and Assets value increment by 1% (only half of the basket increased in value)
        const excessValue: BigNumber = issueAmount.mul(1).div(100)
        const excessQuantity: BigNumber = divCeil(excessValue.mul(BN_SCALE_FACTOR), rate) // Because each unit is now worth $1.02
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessValue)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Expected values
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const expectedToTrader = divCeil(excessQuantity.mul(6000), bn(10000)).sub(6000)
        const expectedToFurnace = divCeil(excessQuantity.mul(4000), bn(10000)).sub(4000) // excessQuantity.sub(expectedToTrader)

        const sellAmt: BigNumber = expectedToTrader
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1.02'), fp('1'))

        const sellAmtRToken: BigNumber = expectedToFurnace
        const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1.02'), fp('1'))

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              token2.address,
              rsr.address,
              withinTolerance(sellAmt),
              withinTolerance(minBuyAmt),
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              token2.address,
              rToken.address,
              withinTolerance(sellAmtRToken),
              withinTolerance(minBuyAmtRToken),
            ],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (restored) - Supply remains constant
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(
          near(await facadeTest.callStatic.totalAssetValue(rToken.address), issueAmount, 10000)
        ).to.equal(true)
        expect(
          (await facadeTest.callStatic.totalAssetValue(rToken.address)).gt(issueAmount)
        ).to.equal(true)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // AToken -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: token2.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market and Traders
        expect(near(await token2.balanceOf(gnosis.address), excessQuantity, 10000)).to.equal(true)
        expect(await token2.balanceOf(gnosis.address)).to.be.closeTo(
          sellAmt.add(sellAmtRToken),
          10000
        )
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToFurnace.sub(sellAmtRToken)
        )
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        //  Check Price (unchanged) and Assets value (unchanged)
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(
          near(await facadeTest.callStatic.totalAssetValue(rToken.address), issueAmount, 10000)
        ).to.equal(true)
        expect(
          (await facadeTest.callStatic.totalAssetValue(rToken.address)).gt(issueAmount)
        ).to.equal(true)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check balances sent to corresponding destinations
        // StRSR
        expect(near(await rsr.balanceOf(stRSR.address), minBuyAmt, 10000)).to.equal(true)
        // Furnace
        expect(near(await rToken.balanceOf(furnace.address), minBuyAmtRToken, 10000)).to.equal(true)
      })

      it('Should not oversend if backingManager.forwardRevenue() is called with duplicate tokens', async () => {
        expect(await basketHandler.fullyCollateralized()).to.be.true

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('1.2'))

        await expect(
          backingManager.forwardRevenue([token2.address, token2.address])
        ).to.be.revertedWith('duplicate tokens')

        await expect(
          backingManager.forwardRevenue([
            token2.address,
            token2.address,
            token2.address,
            token2.address,
          ])
        ).to.be.revertedWith('duplicate tokens')

        await expect(
          backingManager.forwardRevenue([token2.address, token1.address, token2.address])
        ).to.be.revertedWith('duplicate tokens')

        await expect(
          backingManager.forwardRevenue([
            token1.address,
            token2.address,
            token3.address,
            token2.address,
          ])
        ).to.be.revertedWith('duplicate tokens')

        await expect(
          backingManager.forwardRevenue([
            token1.address,
            token2.address,
            token3.address,
            token3.address,
          ])
        ).to.be.revertedWith('duplicate tokens')

        // Remove duplicates, should work
        await expect(
          backingManager.forwardRevenue([token1.address, token2.address, token3.address])
        ).to.not.be.reverted
      })

      it('Should mint RTokens when collateral appreciates and handle revenue auction correctly - Even quantity', async () => {
        // Check Price and Assets value
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('2'))
        await collateral2.refresh()
        await collateral3.refresh()

        // Check Price (unchanged) and Assets value (now doubled)
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set expected minting, based on f = 0.6
        const expectedToTrader = issueAmount.mul(6000).div(10000)
        const expectedToFurnace = issueAmount.sub(expectedToTrader)

        // Set expected auction values
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const newTotalSupply: BigNumber = currentTotalSupply.mul(2)
        const sellAmt: BigNumber = expectedToTrader // everything is auctioned, due to max trade volume
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        // Collect revenue and mint new tokens - Will also launch auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rToken,
            name: 'Transfer',
            args: [ZERO_ADDRESS, backingManager.address, issueAmount],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, rToken.address, rsr.address, sellAmt, withinTolerance(minBuyAmt)],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value - Supply has doubled
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )
        expect(await rToken.totalSupply()).to.equal(newTotalSupply)

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await rToken.balanceOf(furnace.address)).to.equal(expectedToFurnace)

        // Check funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(sellAmt)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // RToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: rToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Perform Mock Bids for RSR(addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        //  End current auction - will not start new one
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, rToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check Price and Assets value - RToken price increases due to melting
        const updatedRTokenPrice: BigNumber = newTotalSupply
          .mul(BN_SCALE_FACTOR)
          .div(await rToken.totalSupply())
        await expectRTokenPrice(rTokenAsset.address, updatedRTokenPrice, ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )

        // Check no funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(0)

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(minBuyAmt, 100000)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
      })

      it('Should mint RTokens and handle remainder when collateral appreciates - Uneven quantity', async () => {
        // Check Price and Assets value
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Change redemption rates for AToken and CToken - Higher for the AToken
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('1.6'))
        await collateral2.refresh()
        await collateral3.refresh()

        // Check Price (unchanged) and Assets value (now 80% higher)
        const excessTotalValue: BigNumber = issueAmount.mul(80).div(100)
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessTotalValue)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations and traders at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set expected values based on f=0.6
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const excessRToken: BigNumber = issueAmount.mul(6000).div(10000)
        const excessCollateralValue: BigNumber = excessTotalValue.sub(excessRToken)
        const excessCollateralQty: BigNumber = excessCollateralValue.div(2) // each unit of this collateral is worth now $2
        const expectedToTraderFromRToken = divCeil(excessRToken.mul(6000), bn(10000))
        const expectedToFurnaceFromRToken = excessRToken.sub(expectedToTraderFromRToken)
        const expectedToRSRTraderFromCollateral = divCeil(excessCollateralQty.mul(6000), bn(10000))
        const expectedToRTokenTraderFromCollateral = excessCollateralQty.sub(
          expectedToRSRTraderFromCollateral
        )

        //  Set expected auction values
        const newTotalSupply: BigNumber = currentTotalSupply.mul(16000).div(10000)
        const sellAmtFromRToken: BigNumber = expectedToTraderFromRToken // all will be processed at once, due to max trade volume of 50%
        const minBuyAmtFromRToken: BigNumber = await toMinBuyAmt(
          sellAmtFromRToken,
          fp('1'),
          fp('1')
        )
        const sellAmtRSRFromCollateral: BigNumber = expectedToRSRTraderFromCollateral // all will be processed at once, due to max trade volume of 50%
        const minBuyAmtRSRFromCollateral: BigNumber = await toMinBuyAmt(
          sellAmtRSRFromCollateral,
          fp('1'),
          fp('1')
        )
        const sellAmtRTokenFromCollateral: BigNumber = expectedToRTokenTraderFromCollateral // all will be processed at once, due to max trade volume of 50%
        const minBuyAmtRTokenFromCollateral: BigNumber = await toMinBuyAmt(
          sellAmtRTokenFromCollateral,
          fp('1'),
          fp('1')
        )

        //  Collect revenue and mint new tokens - Will also launch auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rToken,
            name: 'Transfer',
            args: [ZERO_ADDRESS, backingManager.address, excessRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              rToken.address,
              rsr.address,
              sellAmtFromRToken,
              withinTolerance(minBuyAmtFromRToken),
            ],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              token2.address,
              rsr.address,
              sellAmtRSRFromCollateral,
              withinTolerance(minBuyAmtRSRFromCollateral.mul(2)),
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              token2.address,
              rToken.address,
              sellAmtRTokenFromCollateral,
              withinTolerance(minBuyAmtRTokenFromCollateral.mul(2)),
            ],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (excess collateral not counted anymore) - Supply has increased
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessRToken)
        )
        expect(await rToken.totalSupply()).to.equal(newTotalSupply)

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(
          expectedToTraderFromRToken.sub(sellAmtFromRToken)
        )

        expect(await rToken.balanceOf(furnace.address)).to.equal(expectedToFurnaceFromRToken)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(
          expectedToRSRTraderFromCollateral.sub(sellAmtRSRFromCollateral)
        )
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToRTokenTraderFromCollateral.sub(sellAmtRTokenFromCollateral)
        )

        // Check funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(sellAmtFromRToken)
        expect(await token2.balanceOf(gnosis.address)).to.equal(
          sellAmtRSRFromCollateral.add(sellAmtRTokenFromCollateral)
        )

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // RToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: rToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Collateral -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Collateral -> Rtoken Auction
        await expectTrade(rTokenTrader, {
          sell: token2.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('2'),
        })

        //  Perform Mock Bids for RSR/RToken (addr1 has balance)
        await rsr
          .connect(addr1)
          .approve(gnosis.address, minBuyAmtFromRToken.add(minBuyAmtRSRFromCollateral))
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRTokenFromCollateral)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmtFromRToken,
          buyAmount: minBuyAmtFromRToken,
        })

        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRSRFromCollateral,
          buyAmount: minBuyAmtRSRFromCollateral,
        })

        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRTokenFromCollateral,
          buyAmount: minBuyAmtRTokenFromCollateral,
        })

        //  Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // End current auction, should start a new one with same amount
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, rToken.address, rsr.address, sellAmtFromRToken, minBuyAmtFromRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              token2.address,
              rsr.address,
              sellAmtRSRFromCollateral,
              minBuyAmtRSRFromCollateral,
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              token2.address,
              rToken.address,
              sellAmtRTokenFromCollateral,
              minBuyAmtRTokenFromCollateral,
            ],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check no funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(0)
        expect(await token2.balanceOf(gnosis.address)).to.equal(0)

        //  Check Price and Assets value - RToken price increases due to melting
        const updatedRTokenPrice: BigNumber = newTotalSupply
          .mul(BN_SCALE_FACTOR)
          .div(await rToken.totalSupply())
        await expectRTokenPrice(rTokenAsset.address, updatedRTokenPrice, ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessRToken)
        )

        //  Check destinations
        const expectedRSR = minBuyAmtFromRToken.add(minBuyAmtRSRFromCollateral)
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(
          expectedRSR,
          expectedRSR.div(bn('1e13'))
        )
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)
      })

      it('Should handle backingBuffer when minting RTokens from collateral appreciation', async () => {
        // Set distribution for RToken only (f=0)
        await distributor
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(10000), rsrDist: bn(0) })

        await distributor
          .connect(owner)
          .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

        // Set Backing buffer
        const backingBuffer = fp('0.05')
        await backingManager.connect(owner).setBackingBuffer(backingBuffer)

        // Issue additional RTokens
        const newIssueAmount = bn('900e18')
        await rToken.connect(addr1).issue(newIssueAmount)

        // Check Price and Assets value
        const totalIssuedAmount = issueAmount.add(newIssueAmount)
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          totalIssuedAmount
        )
        expect(await rToken.totalSupply()).to.equal(totalIssuedAmount)

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('1.10'))
        await token3.setExchangeRate(fp('1.10'))
        await collateral2.refresh()
        await collateral3.refresh()

        // Check Price (unchanged) and Assets value (now 10% higher)
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          totalIssuedAmount.mul(110).div(100)
        )
        expect(await rToken.totalSupply()).to.equal(totalIssuedAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set expected minting, based on f = 0.6
        const excessRevenue = totalIssuedAmount
          .mul(110)
          .div(100)
          .mul(BN_SCALE_FACTOR)
          .div(fp('1').add(backingBuffer))
          .sub(await rToken.basketsNeeded())

        // Set expected auction values
        const expectedToFurnace = excessRevenue
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const newTotalSupply: BigNumber = currentTotalSupply.add(excessRevenue)

        // Collect revenue and mint new tokens
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rToken,
            name: 'Transfer',
            args: [ZERO_ADDRESS, backingManager.address, withinTolerance(excessRevenue)],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check Price (unchanged) and Assets value - Supply has increased 10%
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          totalIssuedAmount.mul(110).div(100)
        )
        expect(await rToken.totalSupply()).to.be.closeTo(
          newTotalSupply,
          newTotalSupply.mul(5).div(1000)
        ) // within 0.5%

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          expectedToFurnace,
          expectedToFurnace.mul(5).div(1000)
        )

        // Check Price and Assets value - RToken price increases due to melting
        const updatedRTokenPrice: BigNumber = newTotalSupply
          .mul(BN_SCALE_FACTOR)
          .div(await rToken.totalSupply())
        await expectRTokenPrice(rTokenAsset.address, updatedRTokenPrice, ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          totalIssuedAmount.mul(110).div(100)
        )
      })
    })

    context('With simple basket of ATokens and CTokens: no issued RTokens', function () {
      beforeEach(async function () {
        // Setup new basket with ATokens and CTokens
        await basketHandler
          .connect(owner)
          .setPrimeBasket([token2.address, token3.address], [fp('0.5'), fp('0.5')])
        await basketHandler.connect(owner).refreshBasket()

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should be able to forwardRevenue without changing BU exchange rate', async () => {
        // Check Price and Assets value
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        const mintAmt = bn('10000e18')
        await token2.connect(owner).mint(backingManager.address, mintAmt)
        await token3.connect(owner).mint(backingManager.address, mintAmt)

        await expect(backingManager.forwardRevenue([])).to.emit(rToken, 'Transfer')
        expect(await rToken.totalSupply()).to.equal(mintAmt.mul(2))
        expect(await rToken.basketsNeeded()).to.equal(mintAmt.mul(2))
      })

      it('Should not forward revenue before trading delay', async () => {
        // Set trading delay
        const newDelay = 3600
        await backingManager.connect(owner).setTradingDelay(newDelay) // 1 hour

        const rewardAmt = bn('100e18')
        await token2.setRewards(backingManager.address, rewardAmt)
        await backingManager.claimRewardsSingle(token2.address)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Switch basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(3, [token1.address], [fp('1')], false)

        // Cannot forward revenue yet
        await expect(backingManager.forwardRevenue([aaveToken.address])).to.be.revertedWith(
          'trading delayed'
        )

        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmt)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Advance time post trading delay
        await advanceTime(newDelay + 1)

        // Now we can forward revenue successfully
        await expect(backingManager.forwardRevenue([aaveToken.address])).to.emit(
          aaveToken,
          'Transfer'
        )
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(
          rewardAmt.mul(6000).div(10000)
        )
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(
          rewardAmt.mul(4000).div(10000)
        )
      })
    })
  })

  describeGas('Gas Reporting', () => {
    let issueAmount: BigNumber
    let rewardAmountCOMP: BigNumber
    let rewardAmountAAVE: BigNumber

    beforeEach(async function () {
      issueAmount = bn('100000e18')

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Send BackingManager with nonzero RToken balance to incur maximum gas costs
      await rToken.connect(addr1).transfer(backingManager.address, 1000)

      // Mint some RSR
      await rsr.connect(owner).mint(addr1.address, initialBal)
    })

    it('Claim and Sweep Rewards', async () => {
      // Claim and sweep Rewards - Nothing to claim
      await snapshotGasCost(backingManager.claimRewards())
      await snapshotGasCost(rsrTrader.claimRewards())
      await snapshotGasCost(rTokenTrader.claimRewards())

      // Set Rewards
      rewardAmountCOMP = bn('0.8e18')
      rewardAmountAAVE = bn('0.6e18')

      // COMP Rewards
      await compoundMock.setRewards(token3.address, rewardAmountCOMP)
      await compoundMock.setRewards(rsrTrader.address, rewardAmountCOMP)
      await compoundMock.setRewards(rTokenTrader.address, rewardAmountCOMP)
      await compoundMock.setRewards(rToken.address, rewardAmountCOMP)

      // AAVE Rewards
      await token2.setRewards(backingManager.address, rewardAmountAAVE)
      await token2.setRewards(rsrTrader.address, rewardAmountAAVE)
      await token2.setRewards(rTokenTrader.address, rewardAmountAAVE)
      await token2.setRewards(rToken.address, rewardAmountAAVE)

      // Claim and sweep Rewards - With Rewards
      await snapshotGasCost(backingManager.claimRewards())
      await snapshotGasCost(rsrTrader.claimRewards())
      await snapshotGasCost(rTokenTrader.claimRewards())
    })

    it('Settle Trades / Manage Funds', async () => {
      // Set max auction size for asset
      const chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )
      const newAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          chainlinkFeed.address,
          ORACLE_ERROR,
          compToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT
        )
      )

      // Perform asset swap
      await assetRegistry.connect(owner).swapRegistered(newAsset.address)
      await basketHandler.refreshBasket()

      // Set f = 0.8 (0.2 for Rtoken)
      await distributor
        .connect(owner)
        .setDistribution(FURNACE_DEST, { rTokenDist: bn(10000), rsrDist: bn(0) })
      await distributor
        .connect(owner)
        .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(4) })

      // Set COMP tokens as reward
      rewardAmountCOMP = bn('2e18')

      // COMP Rewards
      await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

      // Collect revenue
      // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
      const sellAmt: BigNumber = bn('1e18') // due to max auction size
      const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

      const sellAmtRToken: BigNumber = rewardAmountCOMP.mul(20).div(100) // All Rtokens can be sold - 20% of total comp based on f
      const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

      await backingManager.claimRewards()

      // Manage Funds
      await backingManager.forwardRevenue([compToken.address])
      await snapshotGasCost(rsrTrader.manageTokens([compToken.address], [TradeKind.BATCH_AUCTION]))
      await snapshotGasCost(
        rTokenTrader.manageTokens([compToken.address], [TradeKind.BATCH_AUCTION])
      )

      // Advance time till auctions ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // Perform Mock Bids for RSR and RToken (addr1 has balance)
      await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
      await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: sellAmt,
        buyAmount: minBuyAmt,
      })
      await gnosis.placeBid(1, {
        bidder: addr1.address,
        sellAmount: sellAmtRToken,
        buyAmount: minBuyAmtRToken,
      })

      // Close auctions
      // Calculate pending amount
      const sellAmtRemainder: BigNumber = rewardAmountCOMP.sub(sellAmt).sub(sellAmtRToken)
      const minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

      // Run auctions - Order: Settle trades, then manage funds
      // Settle trades
      await snapshotGasCost(rsrTrader.settleTrade(compToken.address))
      await snapshotGasCost(rTokenTrader.settleTrade(compToken.address))

      // Manage Funds
      await snapshotGasCost(rsrTrader.manageTokens([compToken.address], [TradeKind.BATCH_AUCTION]))

      // Run final auction until all funds are converted
      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // Perform Mock Bids for RSR and RToken (addr1 has balance)
      await rsr.connect(addr1).approve(gnosis.address, minBuyAmtRemainder)
      await gnosis.placeBid(2, {
        bidder: addr1.address,
        sellAmount: sellAmtRemainder,
        buyAmount: minBuyAmtRemainder,
      })

      // Run auctions - Order: Settle trades, then Manage funds
      // Settle trades
      await snapshotGasCost(rsrTrader.settleTrade(compToken.address))
    })

    it('Selling RToken', async () => {
      await rToken.connect(addr1).transfer(rsrTrader.address, fp('1'))
      await snapshotGasCost(rsrTrader.manageTokens([rToken.address], [TradeKind.DUTCH_AUCTION]))
    })
  })
})
