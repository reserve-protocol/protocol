import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, FURNACE_DEST, STRSR_DEST, ZERO_ADDRESS } from '../common/constants'
import { bn, fp, toBNDecimals } from '../common/numbers'
import { IConfig } from '../common/configuration'
import { expectEvents } from '../common/events'
import { makeDecayFn } from './utils/rewards'
import { advanceTime } from './utils/time'
import {
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeAct,
  FiatCollateral,
  GnosisMock,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  OracleLib,
  StaticATokenMock,
  TestIBackingManager,
  TestIDistributor,
  TestIFurnace,
  TestIRevenueTrader,
  TestIStRSR,
  TestIRToken,
  USDCMock,
} from '../typechain'
import { Collateral, Implementation, IMPLEMENTATION, defaultFixture } from './fixtures'
import snapshotGasCost from './utils/snapshotGasCost'

const createFixtureLoader = waffle.createFixtureLoader

const describeGas =
  IMPLEMENTATION == Implementation.P1 && process.env.REPORT_GAS ? describe : describe.skip

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describe('FacadeAct contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Tokens
  let initialBal: BigNumber
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let aaveToken: ERC20Mock
  let compToken: ERC20Mock
  let compoundMock: ComptrollerMock
  let rsr: ERC20Mock
  let basket: Collateral[]
  let backupToken1: ERC20Mock
  let backupToken2: ERC20Mock

  // Assets
  let tokenAsset: FiatCollateral
  let usdcAsset: FiatCollateral
  let aTokenAsset: ATokenFiatCollateral
  let cTokenAsset: CTokenFiatCollateral
  let backupCollateral1: FiatCollateral
  let backupCollateral2: ATokenFiatCollateral
  let collateral: Collateral[]

  let config: IConfig

  // Facade
  let facadeAct: FacadeAct

  // Main
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let furnace: TestIFurnace
  let basketHandler: IBasketHandler
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let distributor: TestIDistributor
  let gnosis: GnosisMock
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let oracleLib: OracleLib

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()
    let erc20s: ERC20Mock[]

      // Deploy fixture
    ;({
      aaveToken,
      compToken,
      compoundMock,
      assetRegistry,
      backingManager,
      basketHandler,
      distributor,
      stRSR,
      rsr,
      erc20s,
      collateral,
      basket,
      facadeAct,
      rToken,
      config,
      furnace,
      rTokenTrader,
      rsrTrader,
      gnosis,
      oracleLib,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenAsset = <FiatCollateral>basket[0]
    usdcAsset = <FiatCollateral>basket[1]
    aTokenAsset = <ATokenFiatCollateral>basket[2]
    cTokenAsset = <CTokenFiatCollateral>basket[3]

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenAsset.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())

    // Backup tokens and collaterals - USDT - aUSDT - aUSDC - aBUSD
    backupToken1 = erc20s[2] // USDT
    backupCollateral1 = <FiatCollateral>collateral[2]
    backupToken2 = erc20s[9] // aUSDT
    backupCollateral2 = <ATokenFiatCollateral>collateral[9]
  })

  // P1 only
  describeP1('Keepers - getActCallData', () => {
    let issueAmount: BigNumber

    beforeEach(async () => {
      await rToken.connect(owner).setIssuanceRate(fp('1'))

      // Mint Tokens
      initialBal = bn('10000000000e18')
      await token.connect(owner).mint(addr1.address, initialBal)
      await usdc.connect(owner).mint(addr1.address, initialBal)
      await aToken.connect(owner).mint(addr1.address, initialBal)
      await cToken.connect(owner).mint(addr1.address, initialBal)

      await token.connect(owner).mint(addr2.address, initialBal)
      await usdc.connect(owner).mint(addr2.address, initialBal)
      await aToken.connect(owner).mint(addr2.address, initialBal)
      await cToken.connect(owner).mint(addr2.address, initialBal)

      // Mint RSR
      await rsr.connect(owner).mint(addr1.address, initialBal)

      // Issue some RTokens
      issueAmount = bn('100e18')

      // Provide approvals
      await token.connect(addr1).approve(rToken.address, initialBal)
      await usdc.connect(addr1).approve(rToken.address, initialBal)
      await aToken.connect(addr1).approve(rToken.address, initialBal)
      await cToken.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    it('No call required', async () => {
      // Via Facade get next cal - No action required
      const [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(data).to.equal('0x')
    })

    it('Basket changes', async () => {
      // Register Collateral
      await assetRegistry.connect(owner).register(backupCollateral1.address)
      await assetRegistry.connect(owner).register(backupCollateral2.address)

      // Set backup configuration - USDT and aUSDT as backup
      await basketHandler
        .connect(owner)
        .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
          backupToken1.address,
          backupToken2.address,
        ])

      // Check initial state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)

      // Set Token2 to hard default - Decrease rate
      await aToken.setExchangeRate(fp('0.99'))

      // Basket should switch as default is detected immediately
      await assetRegistry.refresh()

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)

      //  Call via Facade - should detect call to Basket handler
      const [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(basketHandler.address)
      expect(data).to.not.equal('0x')

      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      ).to.emit(basketHandler, 'BasketSet')

      // Check state - Basket switch
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
    })

    it('Basket - Should handle no valid basket after refresh', async () => {
      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount)

      // Set simple basket with only one collateral
      await basketHandler.connect(owner).setPrimeBasket([aToken.address], [fp('1')])

      // Set backup config with the same collateral
      await basketHandler
        .connect(owner)
        .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [aToken.address])

      // Switch basket
      await expect(basketHandler.connect(owner).refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [aToken.address], [fp('1')], false)

      // Now default the token, will not be able to find a valid basket
      await aToken.setExchangeRate(fp('0.99'))
      await assetRegistry.refresh()

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

      //  Call via Facade - should not provide call to basket handler
      const [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(data).to.equal('0x')
    })

    it('Trades in Backing Manager', async () => {
      // Setup prime basket
      await basketHandler.connect(owner).setPrimeBasket([usdc.address], [fp('1')])

      // Switch Basket
      await expect(basketHandler.connect(owner).refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [usdc.address], [fp('1')], false)

      // Trigger recollateralization
      const sellAmt: BigNumber = await token.balanceOf(backingManager.address)
      const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

      // Run auction via Facade
      let [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(backingManager, 'TradeStarted')
        .withArgs(anyValue, token.address, usdc.address, sellAmt, toBNDecimals(minBuyAmt, 6))

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)

      // Perform Mock Bids for the new Token (addr1 has balance)
      // Get fair price - all tokens
      await usdc.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: sellAmt,
        buyAmount: toBNDecimals(sellAmt, 6),
      })

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // Trade is ready to be settled - Call settle trade via  Facade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      // End current auction
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(backingManager, 'TradeSettled')
        .withArgs(anyValue, token.address, usdc.address, sellAmt, toBNDecimals(sellAmt, 6))
    })

    it('Revenues/Rewards', async () => {
      const rewardAmountAAVE = bn('0.5e18')

      // AAVE Rewards
      await aToken.setRewards(backingManager.address, rewardAmountAAVE)

      // Via Facade get next call - will claim rewards from backingManager
      let [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      // Claim and sweep rewards
      await owner.sendTransaction({
        to: addr,
        data,
      })

      // Collect revenue
      // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
      const sellAmt: BigNumber = rewardAmountAAVE.mul(60).div(100) // due to f = 60%
      const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

      const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
      const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

      // Via Facade get next call - will transfer RToken to Trader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in Backing Manager
      await owner.sendTransaction({
        to: addr,
        data,
      })

      // Next call would start Revenue auction - RTokenTrader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rTokenTrader.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in RTokenTrader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rTokenTrader, 'TradeStarted')
        .withArgs(anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)

      // Via Facade get next call - will open RSR trade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rsrTrader.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in RSRTrader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rsrTrader, 'TradeStarted')
        .withArgs(anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt)

      // Check funds in Market
      expect(await aaveToken.balanceOf(gnosis.address)).to.equal(rewardAmountAAVE)

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // Mock auction by minting the buy tokens (in this case RSR and RToken)
      await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
      await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: sellAmtRToken,
        buyAmount: minBuyAmtRToken,
      })
      await gnosis.placeBid(1, {
        bidder: addr1.address,
        sellAmount: sellAmt,
        buyAmount: minBuyAmt,
      })

      // Settle RToken trades via Facade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rTokenTrader.address)
      expect(data).to.not.equal('0x')

      // Close auction in RToken Trader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rTokenTrader, 'TradeSettled')
        .withArgs(anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)

      // Now settle trade in RSR Trader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rsrTrader.address)
      expect(data).to.not.equal('0x')

      // Close auction in RSR Trader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rsrTrader, 'TradeSettled')
        .withArgs(anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt)

      // Check no new calls to make from Facade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(data).to.equal('0x')

      // distribute Revenue from RToken trader
      await rTokenTrader.manageToken(rToken.address)

      // Claim additional Revenue but only send to RSR (to trigger RSR trader directly)
      // Set f = 1
      await distributor
        .connect(owner)
        .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

      // Avoid dropping 20 qCOMP by making there be exactly 1 distribution share.
      await distributor
        .connect(owner)
        .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })

      // Set new rewards
      await aToken.setRewards(backingManager.address, rewardAmountAAVE)

      // Claim new rewards
      await backingManager.claimRewards()

      // Via Facade get next call - will transfer RSR to Trader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in Backing Manager
      await owner.sendTransaction({
        to: addr,
        data,
      })

      // Next call would start Revenue auction - RSR Trader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rsrTrader.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in RTokenTrader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rsrTrader, 'TradeStarted')
        .withArgs(
          anyValue,
          aaveToken.address,
          rsr.address,
          rewardAmountAAVE,
          rewardAmountAAVE.sub(rewardAmountAAVE.div(100))
        )
    })

    it('Revenues - Should handle asses with invalid claim logic', async () => {
      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount)

      // Setup a new aToken with invalid claim data
      const ATokenCollateralFactory = await ethers.getContractFactory(
        'InvalidATokenFiatCollateralMock',
        { libraries: { OracleLib: oracleLib.address } }
      )
      const chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )

      const invalidATokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
        ((await ATokenCollateralFactory.deploy(
          fp('1'),
          chainlinkFeed.address,
          aToken.address,
          config.rTokenMaxTradeVolume,
          await aTokenAsset.oracleTimeout(),
          ethers.utils.formatBytes32String('USD'),
          await aTokenAsset.defaultThreshold(),
          await aTokenAsset.delayUntilDefault()
        )) as unknown)
      )

      // Perform asset swap
      await assetRegistry.connect(owner).swapRegistered(invalidATokenCollateral.address)

      // Setup new basket with the invalid AToken
      await basketHandler.connect(owner).setPrimeBasket([aToken.address], [fp('1')])

      // Switch basket
      await basketHandler.connect(owner).refreshBasket()

      const rewardAmountAAVE = bn('0.5e18')

      // AAVE Rewards
      await aToken.setRewards(backingManager.address, rewardAmountAAVE)

      // Via Facade get next call - will not attempt to claim - No action taken
      const [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(data).to.equal('0x')

      // Check status - nothing claimed
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
    })

    it('Revenues - Should handle multiple assets with same reward token', async () => {
      // Update Reward token for AToken to use same as CToken
      const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })
      const chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )

      const newATokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
        await ATokenCollateralFactory.deploy(
          fp('1'),
          chainlinkFeed.address,
          aToken.address,
          config.rTokenMaxTradeVolume,
          await aTokenAsset.oracleTimeout(),
          ethers.utils.formatBytes32String('USD'),
          await aTokenAsset.defaultThreshold(),
          await aTokenAsset.delayUntilDefault()
        )
      )

      // Perform asset swap
      await assetRegistry.connect(owner).swapRegistered(newATokenCollateral.address)

      // Refresh basket
      await basketHandler.connect(owner).refreshBasket()

      const rewardAmount = bn('0.5e18')

      // COMP Rewards for both tokens, in the RToken
      await aToken.setAaveToken(compToken.address) // set it internally in our mock
      await aToken.setRewards(rToken.address, rewardAmount)
      await compoundMock.setRewards(rToken.address, rewardAmount)

      // Via Facade get next call - will Claim and sweep rewards
      const [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(facadeAct.address)
      expect(data).to.not.equal('0x')

      await owner.sendTransaction({
        to: addr,
        data,
      })

      // Check status - rewards claimed for both collaterals
      expect(await compToken.balanceOf(backingManager.address)).to.equal(rewardAmount.mul(2))
    })

    it('Melting', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period
      await furnace.connect(owner).setPeriod(period)

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Advance one period
      await advanceTime(period + 1)

      // Melt via Facade
      let [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(furnace.address)
      expect(data).to.not.equal('0x')

      // Call Melt in Furnace
      await expect(
        addr1.sendTransaction({
          to: addr,
          data,
        })
      ).to.not.emit(rToken, 'Melted')

      // Do not melt twice in same period
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(data).to.equal('0x')

      // Get to the end to melt full amount
      await advanceTime(period + 1)

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 1) // 1 period

      // Melt via Facade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(furnace.address)
      expect(data).to.not.equal('0x')

      // Call Melt in Furnace
      await expect(
        addr1.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rToken, 'Melted')
        .withArgs(hndAmt.sub(expAmt))

      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })

    it('Payout StRSR rewards', async () => {
      const initialRate = fp('1')
      const stakeAmt: BigNumber = bn('1e18')
      const amountAdded: BigNumber = bn('10e18')
      const decayFn: (a: BigNumber, b: number) => BigNumber = makeDecayFn(await stRSR.rewardRatio())

      // Add RSR
      await rsr.connect(addr1).transfer(stRSR.address, amountAdded)

      // Check RSR balance
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amountAdded)

      // Advance to the end of noop period
      await advanceTime(Number(config.rewardPeriod) + 1)

      await expectEvents(stRSR.payoutRewards(), [
        {
          contract: stRSR,
          name: 'ExchangeRateSet',
          args: [initialRate, initialRate],
          emitted: true,
        },
        {
          contract: stRSR,
          name: 'RewardsPaid',
          args: [0],
          emitted: true,
        },
      ])

      // Check exchange rate remains static
      expect(await stRSR.exchangeRate()).to.equal(initialRate)

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stakeAmt)
      await stRSR.connect(addr1).stake(stakeAmt)

      // Advance to get 1 round of rewards
      await advanceTime(Number(config.rewardPeriod) + 1)

      // Calculate payout amount
      const addedRSRStake = amountAdded.sub(decayFn(amountAdded, 1)) // 1 round
      const newRate: BigNumber = fp(stakeAmt.add(addedRSRStake)).div(stakeAmt)

      // Payout rewards - via Facade
      // First do a melt which will first be executed from getActCallData
      await furnace.melt()

      const [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(stRSR.address)
      expect(data).to.not.equal('0x')

      // Payout rewards.
      await expectEvents(
        addr1.sendTransaction({
          to: addr,
          data,
        }),
        [
          {
            contract: stRSR,
            name: 'ExchangeRateSet',
            emitted: true,
          },
          {
            contract: stRSR,
            name: 'RewardsPaid',
            args: [addedRSRStake],
            emitted: true,
          },
        ]
      )

      expect(await stRSR.exchangeRate()).to.be.closeTo(newRate, 1)
      expect(await stRSR.exchangeRate()).to.be.lte(newRate)
    })

    it('Should not revert if f=1', async () => {
      await distributor.connect(owner).setDistribution(FURNACE_DEST, { rTokenDist: 0, rsrDist: 0 })
      // Transfer free tokens to RTokenTrader
      const hndAmt: BigNumber = bn('10e18')
      await rToken.connect(addr1).transfer(rTokenTrader.address, hndAmt)

      let [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(data).to.equal('0x')

      // RSR can be distributed with no issues
      await rsr.connect(addr1).transfer(backingManager.address, hndAmt)
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      expect(await rsr.balanceOf(backingManager.address)).to.equal(hndAmt)
      expect(await rsr.balanceOf(rsrTrader.address)).to.equal(0)

      // Execute managetokens in Backing Manager
      await addr1.sendTransaction({
        to: addr,
        data,
      })

      // RSR forwarded
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
      expect(await rsr.balanceOf(rsrTrader.address)).to.equal(hndAmt)
    })

    it('Should not revert if f=0', async () => {
      await distributor.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: 0, rsrDist: 0 })
      // Transfer free tokens to RTokenTrader
      const hndAmt: BigNumber = bn('10e18')
      await rsr.connect(addr1).transfer(rsrTrader.address, hndAmt)

      let [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(data).to.equal('0x')

      // RToken can be distributed with no issues
      await rToken.connect(addr1).transfer(backingManager.address, hndAmt)
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      expect(await rToken.balanceOf(backingManager.address)).to.equal(hndAmt)
      expect(await rToken.balanceOf(rTokenTrader.address)).to.equal(0)

      // Execute managetokens in Backing Manager
      await addr1.sendTransaction({
        to: addr,
        data,
      })

      // RToken forwarded
      expect(await rToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await rToken.balanceOf(rTokenTrader.address)).to.equal(hndAmt)
    })
  })

  describeGas('Gas Reporting', () => {
    const numAssets = 128

    beforeEach(async () => {
      const m = await ethers.getContractAt('MainP1', await rToken.main())
      const assetRegistry = await ethers.getContractAt('AssetRegistryP1', await m.assetRegistry())
      const ERC20Factory = await ethers.getContractFactory('ERC20Mock')
      const AssetFactory = await ethers.getContractFactory('Asset')
      const feed = await tokenAsset.chainlinkFeed()

      // Get to numAssets registered assets
      for (let i = 0; i < numAssets; i++) {
        const erc20 = await ERC20Factory.deploy('Name', 'Symbol')
        const asset = await AssetFactory.deploy(
          fp('1'),
          feed,
          erc20.address,
          config.rTokenMaxTradeVolume,
          bn(2).pow(47)
        )
        await assetRegistry.connect(owner).register(asset.address)
        const assets = await assetRegistry.erc20s()
        if (assets.length > numAssets) break
      }
      expect((await assetRegistry.erc20s()).length).to.be.gte(numAssets)
    })

    it(`getActCalldata - gas reporting for ${numAssets} registered assets`, async () => {
      await snapshotGasCost(facadeAct.getActCalldata(rToken.address))
      const [addr, bytes] = await facadeAct.callStatic.getActCalldata(rToken.address)
      // Should return 0 addr and 0 bytes, otherwise we didn't use maximum gas
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(bytes).to.equal('0x')
    })
  })
})
