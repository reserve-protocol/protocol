import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  AaveClaimAdapterP0,
  AaveLendingPoolMockP0,
  AssetP0,
  ATokenFiatCollateralP0,
  CollateralP0,
  CompoundClaimAdapterP0,
  CompoundPricedAssetP0,
  ComptrollerMockP0,
  CTokenFiatCollateralP0,
  CTokenMock,
  DeployerP0,
  ERC20Mock,
  ExplorerFacadeP0,
  FurnaceP0,
  MainP0,
  MarketMock,
  RevenueTraderP0,
  RTokenAssetP0,
  RTokenP0,
  StaticATokenMock,
  StRSRP0,
  AssetRegistryP0,
  BackingManagerP0,
  BasketHandlerP0,
  RTokenIssuerP0,
  RevenueDistributorP0,
  USDCMock,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig, IRevenueShare } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('MainP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Claim Adapters
  let compoundClaimer: CompoundClaimAdapterP0
  let aaveClaimer: AaveClaimAdapterP0

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: AssetP0
  let compToken: ERC20Mock
  let compAsset: AssetP0
  let compoundMock: ComptrollerMockP0
  let aaveToken: ERC20Mock
  let aaveAsset: AssetP0
  let aaveMock: AaveLendingPoolMockP0

  // Trading
  let market: MarketMock
  let rsrTrader: RevenueTraderP0
  let rTokenTrader: RevenueTraderP0

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let newToken: ERC20Mock
  let collateral0: CollateralP0
  let collateral1: CollateralP0
  let collateral2: ATokenFiatCollateralP0
  let collateral3: CTokenFiatCollateralP0
  let newAsset: CollateralP0
  let erc20s: ERC20Mock[]

  // Config values
  let config: IConfig
  let dist: IRevenueShare

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let rTokenAsset: RTokenAssetP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let facade: ExplorerFacadeP0
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0
  let rTokenIssuer: RTokenIssuerP0
  let revenueDistributor: RevenueDistributorP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet
  let basket: Collateral[]

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      aaveToken,
      compAsset,
      aaveAsset,
      compoundMock,
      aaveMock,
      erc20s,
      collateral,
      basket,
      config,
      deployer,
      dist,
      main,
      assetRegistry,
      backingManager,
      basketHandler,
      rTokenIssuer,
      revenueDistributor,
      rToken,
      rTokenAsset,
      furnace,
      stRSR,
      market,
      compoundClaimer,
      aaveClaimer,
      facade,
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixture))
    token0 = erc20s[collateral.indexOf(basket[0])]
    token1 = erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    // Set Aave revenue token
    await token2.setAaveToken(aaveToken.address)

    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = <ATokenFiatCollateralP0>basket[2]
    collateral3 = <CTokenFiatCollateralP0>basket[3]

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)
  })

  describe('Deployment', () => {
    it('Should setup Main correctly', async () => {
      // Owner/Pauser
      expect(await main.paused()).to.equal(false)
      expect(await main.owner()).to.equal(owner.address)
      expect(await main.pauser()).to.equal(owner.address)

      // Other components
      expect(await main.stRSR()).to.equal(stRSR.address)
      expect(await main.revenueFurnace()).to.equal(furnace.address)
      expect(await main.market()).to.equal(market.address)

      // Configuration
      let rsrCut = await revenueDistributor.rsrCut()
      expect(rsrCut[0]).to.equal(bn(60))
      expect(rsrCut[1]).to.equal(bn(100))

      let rTokenCut = await revenueDistributor.rTokenCut()
      expect(rTokenCut[0]).to.equal(bn(40))
      expect(rTokenCut[1]).to.equal(bn(100))

      // TODO move check out to individual contract where variable is stored
      // expect(await settings.rewardPeriod()).to.equal(config.rewardPeriod)
      // expect(await settings.auctionLength()).to.equal(config.auctionLength)
      // expect(await settings.stRSRPayPeriod()).to.equal(config.stRSRPayPeriod)
      // expect(await settings.unstakingDelay()).to.equal(config.unstakingDelay)
      // expect(await settings.defaultDelay()).to.equal(config.defaultDelay)
      // expect(await settings.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      // expect(await settings.dustAmount()).to.equal(config.dustAmount)
      // expect(await settings.backingBuffer()).to.equal(config.backingBuffer)
      // expect(await settings.issuanceRate()).to.equal(config.issuanceRate)
      // expect(await settings.defaultThreshold()).to.equal(config.defaultThreshold)
      // expect(await settings.stRSRPayRatio()).to.equal(config.stRSRPayRatio)
    })

    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // RSR
      expect(await assetRegistry.toAsset(rsr.address)).to.equal(rsrAsset.address)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await main.rsr()).to.equal(rsr.address)

      // RToken
      expect(await assetRegistry.toAsset(rToken.address)).to.equal(rTokenAsset.address)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.rToken()).to.equal(rToken.address)

      // Check assets/collateral
      const registeredERC20s = await assetRegistry.registeredERC20s()
      expect(registeredERC20s[0]).to.equal(rToken.address)
      expect(registeredERC20s[1]).to.equal(rsr.address)
      expect(registeredERC20s[2]).to.equal(aaveToken.address)
      expect(registeredERC20s[3]).to.equal(compToken.address)

      const initialTokens: string[] = await Promise.all(
        basket.map(async (c): Promise<string> => {
          return await c.erc20()
        })
      )
      expect(registeredERC20s.slice(4)).to.eql(initialTokens)
      expect(registeredERC20s.length).to.eql((await basketHandler.basketTokens()).length + 4)

      // Assets
      expect(await assetRegistry.toAsset(registeredERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(registeredERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(registeredERC20s[2])).to.equal(aaveAsset.address)
      expect(await assetRegistry.toAsset(registeredERC20s[3])).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(registeredERC20s[4])).to.equal(collateral0.address)
      expect(await assetRegistry.toAsset(registeredERC20s[5])).to.equal(collateral1.address)
      expect(await assetRegistry.toAsset(registeredERC20s[6])).to.equal(collateral2.address)
      expect(await assetRegistry.toAsset(registeredERC20s[7])).to.equal(collateral3.address)

      // Collaterals
      expect(await assetRegistry.toColl(registeredERC20s[4])).to.equal(collateral0.address)
      expect(await assetRegistry.toColl(registeredERC20s[5])).to.equal(collateral1.address)
      expect(await assetRegistry.toColl(registeredERC20s[6])).to.equal(collateral2.address)
      expect(await assetRegistry.toColl(registeredERC20s[7])).to.equal(collateral3.address)
    })

    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing = await basketHandler.basketTokens()
      expect(backing[0]).to.equal(token0.address)
      expect(backing[1]).to.equal(token1.address)
      expect(backing[2]).to.equal(token2.address)
      expect(backing[3]).to.equal(token3.address)

      expect(backing.length).to.equal(4)

      // Check other values
      expect((await basketHandler.basketLastSet())[0]).to.be.gt(bn(0))
      expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
      expect(await facade.totalAssetValue()).to.equal(0)

      // Check RToken price
      expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))
    })
  })

  describe('Initialization', () => {
    it('Should not allow to initialize Main twice', async () => {
      const ctorArgs = {
        params: config,
        core: {
          rToken: rToken.address,
          stRSR: stRSR.address,
          assetRegistry: assetRegistry.address,
          basketHandler: basketHandler.address,
          backingManager: backingManager.address,
          rTokenIssuer: rTokenIssuer.address,
          revenueDistributor: revenueDistributor.address,
          rsrTrader: rsrTrader.address,
          rTokenTrader: rTokenTrader.address,
        },
        periphery: {
          furnace: furnace.address,
          market: market.address,
          claimAdapters: [compoundClaimer.address, aaveClaimer.address],
          assets: [rTokenAsset.address, rsrAsset.address, compAsset.address, aaveAsset.address],
        },
        rsr: rsr.address,
      }
      await expect(main.init(ctorArgs)).to.be.revertedWith('Already initialized')
    })

    it('Should perform validations on init', async () => {
      // Set invalid RSRPayPeriod
      const newConfig = { ...config }
      newConfig.rewardPeriod = config.unstakingDelay

      // Deploy new system instance
      await expect(
        deployer.deploy('RTKN RToken', 'RTKN', owner.address, newConfig)
      ).to.be.revertedWith('unstakingDelay/rewardPeriod incompatible')
    })
  })

  describe('Pause/Unpause', () => {
    it('Should Pause/Unpause for Pauser and Owner', async () => {
      // Set different Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Check initial status
      expect(await main.pauser()).to.equal(addr1.address)
      expect(await main.paused()).to.equal(false)

      // Pause with Pauser
      await main.connect(addr1).pause()

      // Check if Paused
      expect(await main.paused()).to.equal(true)

      // Unpause with Pauser
      await main.connect(addr1).unpause()

      expect(await main.paused()).to.equal(false)

      // Owner should still be able to Pause
      await main.connect(owner).pause()

      // Check if Paused
      expect(await main.paused()).to.equal(true)

      // Unpause with Owner
      await main.connect(owner).unpause()

      expect(await main.paused()).to.equal(false)
    })

    it('Should not allow to Pause/Unpause if not Pauser or Owner', async () => {
      // Set different Pauser
      await main.connect(owner).setPauser(addr1.address)

      await expect(main.connect(other).pause()).to.be.revertedWith('only pauser or owner')

      // Check no changes
      expect(await main.paused()).to.equal(false)

      await expect(main.connect(other).unpause()).to.be.revertedWith('only pauser or owner')

      // Check no changes
      expect(await main.paused()).to.equal(false)
    })

    it('Should allow to set Pauser if Owner or Pauser', async () => {
      // Set Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Check Pauser updated
      expect(await main.pauser()).to.equal(addr1.address)

      // Now update it with Pauser
      await main.connect(addr1).setPauser(owner.address)

      // Check Pauser updated
      expect(await main.pauser()).to.equal(owner.address)
    })

    it('Should not allow to set Pauser if not Owner', async () => {
      // Set Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Set Pauser
      await expect(main.connect(other).setPauser(other.address)).to.be.revertedWith(
        'only pauser or owner'
      )

      // Check Pauser not updated
      expect(await main.pauser()).to.equal(addr1.address)
    })
  })

  // TODO Move test into the specific test file for that variable
  describe('Configuration/State', () => {
    // it('Should allow to update rewardPeriod if Owner', async () => {
    //   const newValue: BigNumber = bn('360')

    //   // Check existing value
    //   expect(await settings.rewardPeriod()).to.equal(config.rewardPeriod)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setRewardPeriod(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.rewardPeriod()).to.equal(config.rewardPeriod)

    //   // Update with owner
    //   await expect(settings.connect(owner).setRewardPeriod(newValue))
    //     .to.emit(settings, 'RewardPeriodSet')
    //     .withArgs(config.rewardPeriod, newValue)

    //   // Check value was updated
    //   expect(await settings.rewardPeriod()).to.equal(newValue)
    // })

    // it('Should allow to update auctionLength if Owner', async () => {
    //   const newValue: BigNumber = bn('360')

    //   // Check existing value
    //   expect(await settings.auctionLength()).to.equal(config.auctionLength)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setAuctionLength(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.auctionLength()).to.equal(config.auctionLength)

    //   // Update with owner
    //   await expect(settings.connect(owner).setAuctionLength(newValue))
    //     .to.emit(settings, 'AuctionLengthSet')
    //     .withArgs(config.auctionLength, newValue)

    //   // Check value was updated
    //   expect(await settings.auctionLength()).to.equal(newValue)
    // })

    // it('Should allow to update stRSRPayPeriod if Owner and perform validations', async () => {
    //   const newValue: BigNumber = config.stRSRPayPeriod.div(2)

    //   // Check existing value
    //   expect(await settings.stRSRPayPeriod()).to.equal(config.stRSRPayPeriod)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setStRSRPayPeriod(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Reverts if the value is too long
    //   const invalidValue: BigNumber = config.unstakingDelay
    //   await expect(settings.connect(owner).setStRSRPayPeriod(invalidValue)).to.be.revertedWith(
    //     'RSR pay period too long'
    //   )

    //   // Check value did not change
    //   expect(await settings.stRSRPayPeriod()).to.equal(config.stRSRPayPeriod)

    //   // Update with owner
    //   await expect(settings.connect(owner).setStRSRPayPeriod(newValue))
    //     .to.emit(settings, 'StRSRPayPeriodSet')
    //     .withArgs(config.stRSRPayPeriod, newValue)

    //   // Check value was updated
    //   expect(await settings.stRSRPayPeriod()).to.equal(newValue)
    // })

    // it('Should allow to update unstakingDelay if Owner and perform validations', async () => {
    //   const newValue: BigNumber = config.unstakingDelay.div(2)

    //   // Check existing value
    //   expect(await settings.unstakingDelay()).to.equal(config.unstakingDelay)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setStRSRWithdrawalDelay(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Reverts if the value is too short
    //   const invalidValue: BigNumber = config.stRSRPayPeriod
    //   await expect(
    //     settings.connect(owner).setStRSRWithdrawalDelay(invalidValue)
    //   ).to.be.revertedWith('RSR withdrawal delay too short')

    //   // Check value did not change
    //   expect(await settings.unstakingDelay()).to.equal(config.unstakingDelay)

    //   // Update with owner
    //   await expect(settings.connect(owner).setStRSRWithdrawalDelay(newValue))
    //     .to.emit(settings, 'StRSRWithdrawalDelaySet')
    //     .withArgs(config.unstakingDelay, newValue)

    //   // Check value was updated
    //   expect(await settings.unstakingDelay()).to.equal(newValue)
    // })

    // it('Should allow to update defaultDelay if Owner', async () => {
    //   const newValue: BigNumber = bn('360')

    //   // Check existing value
    //   expect(await settings.defaultDelay()).to.equal(config.defaultDelay)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setDefaultDelay(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.defaultDelay()).to.equal(config.defaultDelay)

    //   // Update with owner
    //   await expect(settings.connect(owner).setDefaultDelay(newValue))
    //     .to.emit(settings, 'DefaultDelaySet')
    //     .withArgs(config.defaultDelay, newValue)

    //   // Check value was updated
    //   expect(await settings.defaultDelay()).to.equal(newValue)
    // })

    // it('Should allow to update maxTradeSlippage if Owner', async () => {
    //   const newValue: BigNumber = fp('0.02')

    //   // Check existing value
    //   expect(await settings.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setMaxTradeSlippage(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

    //   // Update with owner
    //   await expect(settings.connect(owner).setMaxTradeSlippage(newValue))
    //     .to.emit(settings, 'MaxTradeSlippageSet')
    //     .withArgs(config.maxTradeSlippage, newValue)

    //   // Check value was updated
    //   expect(await settings.maxTradeSlippage()).to.equal(newValue)
    // })

    // it('Should allow to update dustAmount if Owner', async () => {
    //   const newValue: BigNumber = fp('0.02')

    //   // Check existing value
    //   expect(await settings.dustAmount()).to.equal(config.dustAmount)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setDustAmount(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.dustAmount()).to.equal(config.dustAmount)

    //   // Update with owner
    //   await expect(settings.connect(owner).setDustAmount(newValue))
    //     .to.emit(settings, 'DustAmountSet')
    //     .withArgs(config.dustAmount, newValue)

    //   // Check value was updated
    //   expect(await settings.dustAmount()).to.equal(newValue)
    // })

    // it('Should allow to update backingBuffer if Owner', async () => {
    //   const newValue: BigNumber = fp('0.02')

    //   // Check existing value
    //   expect(await settings.backingBuffer()).to.equal(config.backingBuffer)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setBackingBuffer(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.backingBuffer()).to.equal(config.backingBuffer)

    //   // Update with owner
    //   await expect(settings.connect(owner).setBackingBuffer(newValue))
    //     .to.emit(settings, 'BackingBufferSet')
    //     .withArgs(config.backingBuffer, newValue)

    //   // Check value was updated
    //   expect(await settings.backingBuffer()).to.equal(newValue)
    // })

    // it('Should allow to update issuanceRate if Owner', async () => {
    //   const newValue: BigNumber = fp('0.1')

    //   // Check existing value
    //   expect(await settings.issuanceRate()).to.equal(config.issuanceRate)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setIssuanceRate(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.issuanceRate()).to.equal(config.issuanceRate)

    //   // Update with owner
    //   await expect(settings.connect(owner).setIssuanceRate(newValue))
    //     .to.emit(settings, 'IssuanceRateSet')
    //     .withArgs(config.issuanceRate, newValue)

    //   // Check value was updated
    //   expect(await settings.issuanceRate()).to.equal(newValue)
    // })

    // it('Should allow to update defaultThreshold if Owner', async () => {
    //   const newValue: BigNumber = fp('0.1')

    //   // Check existing value
    //   expect(await settings.defaultThreshold()).to.equal(config.defaultThreshold)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setDefaultThreshold(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.defaultThreshold()).to.equal(config.defaultThreshold)

    //   // Update with owner
    //   await expect(settings.connect(owner).setDefaultThreshold(newValue))
    //     .to.emit(settings, 'DefaultThresholdSet')
    //     .withArgs(config.defaultThreshold, newValue)

    //   // Check value was updated
    //   expect(await settings.defaultThreshold()).to.equal(newValue)
    // })

    // it('Should allow to update stRSRPayRatio if Owner', async () => {
    //   const newValue: BigNumber = config.stRSRPayRatio.div(2)

    //   // Check existing value
    //   expect(await settings.stRSRPayRatio()).to.equal(config.stRSRPayRatio)

    //   // If not owner cannot update
    //   await expect(settings.connect(other).setStRSRPayRatio(newValue)).to.be.revertedWith(
    //     'Component: caller is not the owner'
    //   )

    //   // Check value did not change
    //   expect(await settings.stRSRPayRatio()).to.equal(config.stRSRPayRatio)

    //   // Update with owner
    //   await expect(settings.connect(owner).setStRSRPayRatio(newValue))
    //     .to.emit(settings, 'StRSRPayRatioSet')
    //     .withArgs(config.stRSRPayRatio, newValue)

    //   // Check value was updated
    //   expect(await settings.stRSRPayRatio()).to.equal(newValue)
    // })

    it('Should return backing tokens', async () => {
      expect(await basketHandler.basketTokens()).to.eql([
        token0.address,
        token1.address,
        token2.address,
        token3.address,
      ])
    })

    it('Should allow to set Market if Owner', async () => {
      // Check existing value
      expect(await main.market()).to.equal(market.address)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).setMarket(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.market()).to.equal(market.address)

      // Update with owner
      await expect(main.connect(owner).setMarket(other.address))
        .to.emit(main, 'MarketSet')
        .withArgs(market.address, other.address)

      // Check value was updated
      expect(await main.market()).to.equal(other.address)
    })

    it('Should allow to set RSR if Owner', async () => {
      // Check existing value
      expect(await main.rsr()).to.equal(rsr.address)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).setRSR(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.rsr()).to.equal(rsr.address)

      // Update with owner
      await expect(main.connect(owner).setRSR(other.address))
        .to.emit(main, 'RSRSet')
        .withArgs(rsr.address, other.address)

      // Check value was updated
      expect(await main.rsr()).to.equal(other.address)
    })

    it('Should allow to set StRSR if Owner', async () => {
      // Check existing value
      expect(await main.stRSR()).to.equal(stRSR.address)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).setStRSR(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.stRSR()).to.equal(stRSR.address)

      // Update with owner
      await expect(main.connect(owner).setStRSR(other.address))
        .to.emit(main, 'StRSRSet')
        .withArgs(stRSR.address, other.address)

      // Check value was updated
      expect(await main.stRSR()).to.equal(other.address)
    })

    it('Should allow to set RToken if Owner', async () => {
      // Check existing value
      expect(await main.rToken()).to.equal(rToken.address)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).setRToken(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.rToken()).to.equal(rToken.address)

      // Update with owner
      await expect(main.connect(owner).setRToken(other.address))
        .to.emit(main, 'RTokenSet')
        .withArgs(rToken.address, other.address)

      // Check value was updated
      expect(await main.rToken()).to.equal(other.address)
    })

    it('Should allow to add ClaimAdapter if Owner', async () => {
      // Check existing value
      expect(await main.isTrustedClaimAdapter(other.address)).to.equal(false)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).addClaimAdapter(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.isTrustedClaimAdapter(other.address)).to.equal(false)

      // Update with owner
      await expect(main.connect(owner).addClaimAdapter(other.address))
        .to.emit(main, 'ClaimAdapterAdded')
        .withArgs(other.address)

      // Check value was updated
      expect(await main.isTrustedClaimAdapter(other.address)).to.equal(true)
    })

    it('Should allow to remove ClaimAdapter if Owner', async () => {
      // Check existing value
      expect(await main.isTrustedClaimAdapter(compoundClaimer.address)).to.equal(true)

      // If not owner cannot update - use mock address
      await expect(
        main.connect(other).removeClaimAdapter(compoundClaimer.address)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Check value did not change
      expect(await main.isTrustedClaimAdapter(compoundClaimer.address)).to.equal(true)

      // Update with owner
      await expect(main.connect(owner).removeClaimAdapter(compoundClaimer.address))
        .to.emit(main, 'ClaimAdapterRemoved')
        .withArgs(compoundClaimer.address)

      // Check value was updated
      expect(await main.isTrustedClaimAdapter(compoundClaimer.address)).to.equal(false)
    })

    it('Should allow to set RevenueFurnace if Owner and perform validations', async () => {
      // Setup test furnaces
      const FurnaceFactory: ContractFactory = await ethers.getContractFactory('FurnaceP0')
      const newFurnace = <FurnaceP0>(
        await FurnaceFactory.deploy(rToken.address, config.rewardPeriod, config.rewardRatio)
      )

      // Check existing value
      expect(await main.revenueFurnace()).to.equal(furnace.address)

      // If not owner cannot update
      await expect(main.connect(other).setRevenueFurnace(newFurnace.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.revenueFurnace()).to.equal(furnace.address)

      // Update with owner
      await expect(main.connect(owner).setRevenueFurnace(newFurnace.address))
        .to.emit(main, 'RevenueFurnaceSet')
        .withArgs(furnace.address, newFurnace.address)

      // Check value was updated
      expect(await main.revenueFurnace()).to.equal(newFurnace.address)
    })
  })

  describe('Asset Registry', () => {
    it('Should confirm if ERC20s are registered', async () => {
      expect(await assetRegistry.isRegistered(token0.address)).to.equal(true)
      expect(await assetRegistry.isRegistered(token1.address)).to.equal(true)
      expect(await assetRegistry.isRegistered(token2.address)).to.equal(true)
      expect(await assetRegistry.isRegistered(token3.address)).to.equal(true)

      // Try with non-registered address
      expect(await assetRegistry.isRegistered(other.address)).to.equal(false)
    })

    it('Should allow to register Asset if Owner', async () => {
      // Setup new Asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAssetP0')
      const newAsset: CompoundPricedAssetP0 = <CompoundPricedAssetP0>(
        await AssetFactory.deploy(
          erc20s[5].address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.registeredERC20s()).length

      // Cannot add asset if not owner
      await expect(assetRegistry.connect(other).registerAsset(newAsset.address)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Nothing occurs if attempting to add an existing asset
      await assetRegistry.connect(owner).registerAsset(aaveAsset.address)

      // Check nothing changed
      let allERC20s = await assetRegistry.registeredERC20s()
      expect(allERC20s.length).to.equal(previousLength)

      // Add new asset
      await expect(assetRegistry.connect(owner).registerAsset(newAsset.address))
        .to.emit(assetRegistry, 'AssetRegistered')
        .withArgs(erc20s[5].address, newAsset.address)

      // Check it was added
      allERC20s = await assetRegistry.registeredERC20s()
      expect(allERC20s).to.contain(erc20s[5].address)
      expect(allERC20s.length).to.equal(previousLength + 1)
    })

    it('Should allow to unregister asset if Owner', async () => {
      // Setup new Asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAssetP0')
      const newAsset: CompoundPricedAssetP0 = <CompoundPricedAssetP0>(
        await AssetFactory.deploy(
          token0.address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.registeredERC20s()).length

      // Check assets
      let allERC20s = await assetRegistry.registeredERC20s()
      expect(allERC20s).to.contain(compToken.address)
      expect(allERC20s).to.not.contain(erc20s[5].address)

      // Cannot remove asset if not owner
      await expect(
        assetRegistry.connect(other).unregisterAsset(compAsset.address)
      ).to.be.revertedWith('Component: caller is not the owner')

      // Cannot remove asset that does not exist
      await expect(
        assetRegistry.connect(owner).unregisterAsset(newAsset.address)
      ).to.be.revertedWith('asset not found')

      // Check nothing changed
      allERC20s = await assetRegistry.registeredERC20s()
      expect(allERC20s.length).to.equal(previousLength)
      expect(allERC20s).to.contain(compToken.address)
      expect(allERC20s).to.not.contain(erc20s[5].address)

      // Remove asset
      await assetRegistry.connect(owner).unregisterAsset(compAsset.address)

      // Check if it was removed
      allERC20s = await assetRegistry.registeredERC20s()
      expect(allERC20s).to.not.contain(compToken.address)
      expect(allERC20s.length).to.equal(previousLength - 1)
    })

    it('Should allow to swap Asset if Owner', async () => {
      // Setup new Asset - Reusing token
      const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAssetP0')
      const newAsset: CompoundPricedAssetP0 = <CompoundPricedAssetP0>(
        await AssetFactory.deploy(
          token0.address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Setup another one with new token (cannot be used in swap)
      const invalidAssetForSwap: CompoundPricedAssetP0 = <CompoundPricedAssetP0>(
        await AssetFactory.deploy(
          erc20s[5].address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.registeredERC20s()).length

      // Cannot swap asset if not owner
      await expect(
        assetRegistry.connect(other).swapRegisteredAsset(newAsset.address)
      ).to.be.revertedWith('Component: caller is not the owner')

      // Cannot swap asset if ERC20 is not registered
      await expect(
        assetRegistry.connect(owner).swapRegisteredAsset(invalidAssetForSwap.address)
      ).to.be.revertedWith('no ERC20 collision')

      // Check asset remains the same
      expect(await assetRegistry.toAsset(token0.address)).to.equal(collateral0.address)

      // Swap Asset
      await expect(assetRegistry.connect(owner).swapRegisteredAsset(newAsset.address))
        .to.emit(main, 'AssetUnregistered')
        .withArgs(token0.address, collateral0.address)
        .and.to.emit(assetRegistry, 'AssetRegistered')
        .withArgs(token0.address, newAsset.address)

      // Check length is not modified and erc20 remains registered
      let allERC20s = await assetRegistry.registeredERC20s()
      expect(allERC20s).to.contain(token0.address)
      expect(allERC20s.length).to.equal(previousLength)

      // Check asset was modified
      expect(await assetRegistry.toAsset(token0.address)).to.equal(newAsset.address)
    })

    it('Should return the Asset for an ERC20 and perform validations', async () => {
      // Reverts if ERC20 is not registered
      await expect(assetRegistry.toAsset(other.address)).to.be.revertedWith('erc20 unregistered')

      // Reverts if no registered asset - After unregister
      await assetRegistry.connect(owner).unregisterAsset(rsrAsset.address)
      await expect(assetRegistry.toAsset(rsr.address)).to.be.revertedWith('erc20 unregistered')

      // Returns correctly the asset
      expect(await assetRegistry.toAsset(rToken.address)).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(aaveToken.address)).to.equal(aaveAsset.address)
      expect(await assetRegistry.toAsset(compToken.address)).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(token0.address)).to.equal(collateral0.address)
      expect(await assetRegistry.toAsset(token1.address)).to.equal(collateral1.address)
      expect(await assetRegistry.toAsset(token2.address)).to.equal(collateral2.address)
      expect(await assetRegistry.toAsset(token3.address)).to.equal(collateral3.address)
    })

    it('Should return the Collateral for an ERC20 and perform validations', async () => {
      // Reverts if ERC20 is not registered
      await expect(assetRegistry.toColl(other.address)).to.be.revertedWith('erc20 unregistered')

      // Reverts if no registered collateral - After unregister
      await assetRegistry.connect(owner).unregisterAsset(collateral0.address)
      await expect(assetRegistry.toColl(token0.address)).to.be.revertedWith('erc20 unregistered')

      // Reverts if asset is not collateral
      await expect(assetRegistry.toColl(rsr.address)).to.be.revertedWith('erc20 is not collateral')

      // Returns correctly the collaterals
      expect(await assetRegistry.toColl(token1.address)).to.equal(collateral1.address)
      expect(await assetRegistry.toColl(token2.address)).to.equal(collateral2.address)
      expect(await assetRegistry.toColl(token3.address)).to.equal(collateral3.address)
    })
  })

  describe('Basket Handling', () => {
    it('Should not allow to set prime Basket if not Owner', async () => {
      await expect(
        basketHandler.connect(other).setPrimeBasket([collateral0.address], [fp('1')])
      ).to.be.revertedWith('Component: caller is not the owner')
    })

    it('Should not allow to set prime Basket with invalid length', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([collateral0.address], [])
      ).to.be.revertedWith('must be same length')
    })

    it('Should allow to set prime Basket if Owner', async () => {
      // Set basket
      await expect(basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')]))
        .to.emit(basketHandler, 'PrimeBasketSet')
        .withArgs([token0.address], [fp('1')])
    })

    it('Should not allow to set backup Config if not Owner', async () => {
      await expect(
        basketHandler
          .connect(other)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
      ).to.be.revertedWith('Component: caller is not the owner')
    })

    it('Should allow to set backup Config if Owner', async () => {
      // Set basket
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
      )
        .to.emit(basketHandler, 'BackupConfigSet')
        .withArgs(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
    })

    it('Should not allow to switch basket if not Owner', async () => {
      await expect(basketHandler.connect(other).switchBasket()).to.be.revertedWith(
        'Component: caller is not the owner'
      )
    })

    it('Should allow to call switch Basket if Owner - No changes', async () => {
      // Switch basket - No backup nor default
      await expect(basketHandler.connect(owner).switchBasket()).to.emit(basketHandler, 'BasketSet')

      // Basket remains the same in this case
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing = await basketHandler.basketTokens()
      expect(backing[0]).to.equal(token0.address)
      expect(backing[1]).to.equal(token1.address)
      expect(backing[2]).to.equal(token2.address)
      expect(backing[3]).to.equal(token3.address)

      expect(backing.length).to.equal(4)

      // Not updated so basket last changed is not set
      expect((await basketHandler.basketLastSet())[0]).to.be.gt(bn(1))
      expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
      expect(await facade.totalAssetValue()).to.equal(0)
    })
  })
})
