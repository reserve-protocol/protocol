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
      rToken,
      rTokenAsset,
      furnace,
      stRSR,
      market,
      compoundClaimer,
      aaveClaimer,
      facade,
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

    rsrTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rsrTrader())
    )
    rTokenTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rTokenTrader())
    )

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
      let rsrCut = await main.rsrCut()
      expect(rsrCut[0]).to.equal(bn(60))
      expect(rsrCut[1]).to.equal(bn(100))

      let rTokenCut = await main.rTokenCut()
      expect(rTokenCut[0]).to.equal(bn(40))
      expect(rTokenCut[1]).to.equal(bn(100))

      expect(await main.rewardStart()).to.equal(config.rewardStart)
      expect(await main.rewardPeriod()).to.equal(config.rewardPeriod)
      expect(await main.auctionPeriod()).to.equal(config.auctionPeriod)
      expect(await main.stRSRPayPeriod()).to.equal(config.stRSRPayPeriod)
      expect(await main.stRSRWithdrawalDelay()).to.equal(config.stRSRWithdrawalDelay)
      expect(await main.defaultDelay()).to.equal(config.defaultDelay)
      expect(await main.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await main.dustAmount()).to.equal(config.dustAmount)
      expect(await main.backingBuffer()).to.equal(config.backingBuffer)
      expect(await main.issuanceRate()).to.equal(config.issuanceRate)
      expect(await main.defaultThreshold()).to.equal(config.defaultThreshold)
      expect(await main.stRSRPayRatio()).to.equal(config.stRSRPayRatio)
    })

    it('Should register Assets correctly', async () => {
      // RSR
      expect(await main.toAsset(rsr.address)).to.equal(rsrAsset.address)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await main.rsr()).to.equal(rsr.address)

      // RToken
      expect(await main.toAsset(rToken.address)).to.equal(rTokenAsset.address)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.rToken()).to.equal(rToken.address)

      // Check assets/collateral
      const registeredERC20s = await main.registeredERC20s()
      expect(await main.toAsset(registeredERC20s[0])).to.equal(rTokenAsset.address)
      expect(await main.toAsset(registeredERC20s[1])).to.equal(rsrAsset.address)
      expect(await main.toAsset(registeredERC20s[2])).to.equal(aaveAsset.address)
      expect(await main.toAsset(registeredERC20s[3])).to.equal(compAsset.address)
      expect(registeredERC20s.length).to.eql((await main.basketTokens()).length + 4)
    })

    it('Should register Basket correctly', async () => {
      // Basket
      expect(await main.fullyCapitalized()).to.equal(true)
      const backing = await main.basketTokens()
      expect(backing[0]).to.equal(token0.address)
      expect(backing[1]).to.equal(token1.address)
      expect(backing[2]).to.equal(token2.address)
      expect(backing[3]).to.equal(token3.address)

      expect(backing.length).to.equal(4)

      // Check other values
      expect(await main.basketNonce()).to.be.gt(bn(0))
      expect(await main.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
      expect(await facade.totalAssetValue()).to.equal(0)

      // Check RToken price
      expect(await main.rTokenPrice()).to.equal(fp('1'))
    })
  })

  describe('Initialization', () => {
    it('Should not allow to initialize Main twice', async () => {
      const ctorArgs = {
        config: config,
        dist: dist,
        furnace: furnace.address,
        market: market.address,
        rsr: rsr.address,
        stRSR: stRSR.address,
        rToken: rToken.address,
        claimAdapters: [compoundClaimer.address, aaveClaimer.address],
        assets: [rTokenAsset.address, rsrAsset.address, compAsset.address, aaveAsset.address],
      }
      await expect(main.init(ctorArgs)).to.be.revertedWith('already initialized')
    })

    it('Should perform validations on init', async () => {
      const MainFactory: ContractFactory = await ethers.getContractFactory('MainP0')
      const newMain: MainP0 = <MainP0>await MainFactory.deploy()
      await newMain.connect(owner).unpause()

      // Set invalid RSRPayPeriod
      const newConfig = { ...config }
      newConfig.stRSRPayPeriod = config.stRSRWithdrawalDelay

      // Deploy new main
      const ctorArgs = {
        config: newConfig,
        dist: dist,
        furnace: furnace.address,
        market: market.address,
        rsr: rsr.address,
        stRSR: stRSR.address,
        rToken: rToken.address,
        claimAdapters: [compoundClaimer.address, aaveClaimer.address],
        assets: [rTokenAsset.address, rsrAsset.address, compAsset.address, aaveAsset.address],
      }
      await expect(newMain.init(ctorArgs)).to.be.revertedWith('RSR pay period too long')
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

  describe('Configuration/State', () => {
    it('Should allow to update rewardStart if Owner', async () => {
      const newValue: BigNumber = bn(await getLatestBlockTimestamp())

      // Check existing value
      expect(await main.rewardStart()).to.equal(config.rewardStart)

      // If not owner cannot update
      await expect(main.connect(other).setRewardStart(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.rewardStart()).to.equal(config.rewardStart)

      // Update with owner
      await expect(main.connect(owner).setRewardStart(newValue))
        .to.emit(main, 'RewardStartSet')
        .withArgs(config.rewardStart, newValue)

      // Check value was updated
      expect(await main.rewardStart()).to.equal(newValue)
    })

    it('Should allow to update rewardPeriod if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await main.rewardPeriod()).to.equal(config.rewardPeriod)

      // If not owner cannot update
      await expect(main.connect(other).setRewardPeriod(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.rewardPeriod()).to.equal(config.rewardPeriod)

      // Update with owner
      await expect(main.connect(owner).setRewardPeriod(newValue))
        .to.emit(main, 'RewardPeriodSet')
        .withArgs(config.rewardPeriod, newValue)

      // Check value was updated
      expect(await main.rewardPeriod()).to.equal(newValue)
    })

    it('Should allow to update auctionPeriod if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await main.auctionPeriod()).to.equal(config.auctionPeriod)

      // If not owner cannot update
      await expect(main.connect(other).setAuctionPeriod(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.auctionPeriod()).to.equal(config.auctionPeriod)

      // Update with owner
      await expect(main.connect(owner).setAuctionPeriod(newValue))
        .to.emit(main, 'AuctionPeriodSet')
        .withArgs(config.auctionPeriod, newValue)

      // Check value was updated
      expect(await main.auctionPeriod()).to.equal(newValue)
    })

    it('Should allow to update stRSRPayPeriod if Owner and perform validations', async () => {
      const newValue: BigNumber = config.stRSRPayPeriod.div(2)

      // Check existing value
      expect(await main.stRSRPayPeriod()).to.equal(config.stRSRPayPeriod)

      // If not owner cannot update
      await expect(main.connect(other).setStRSRPayPeriod(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Reverts if the value is too long
      const invalidValue: BigNumber = config.stRSRWithdrawalDelay
      await expect(main.connect(owner).setStRSRPayPeriod(invalidValue)).to.be.revertedWith(
        'RSR pay period too long'
      )

      // Check value did not change
      expect(await main.stRSRPayPeriod()).to.equal(config.stRSRPayPeriod)

      // Update with owner
      await expect(main.connect(owner).setStRSRPayPeriod(newValue))
        .to.emit(main, 'StRSRPayPeriodSet')
        .withArgs(config.stRSRPayPeriod, newValue)

      // Check value was updated
      expect(await main.stRSRPayPeriod()).to.equal(newValue)
    })

    it('Should allow to update stRSRWithdrawalDelay if Owner and perform validations', async () => {
      const newValue: BigNumber = config.stRSRWithdrawalDelay.div(2)

      // Check existing value
      expect(await main.stRSRWithdrawalDelay()).to.equal(config.stRSRWithdrawalDelay)

      // If not owner cannot update
      await expect(main.connect(other).setStRSRWithdrawalDelay(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Reverts if the value is too short
      const invalidValue: BigNumber = config.stRSRPayPeriod
      await expect(main.connect(owner).setStRSRWithdrawalDelay(invalidValue)).to.be.revertedWith(
        'RSR withdrawal delay too short'
      )

      // Check value did not change
      expect(await main.stRSRWithdrawalDelay()).to.equal(config.stRSRWithdrawalDelay)

      // Update with owner
      await expect(main.connect(owner).setStRSRWithdrawalDelay(newValue))
        .to.emit(main, 'StRSRWithdrawalDelaySet')
        .withArgs(config.stRSRWithdrawalDelay, newValue)

      // Check value was updated
      expect(await main.stRSRWithdrawalDelay()).to.equal(newValue)
    })

    it('Should allow to update defaultDelay if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await main.defaultDelay()).to.equal(config.defaultDelay)

      // If not owner cannot update
      await expect(main.connect(other).setDefaultDelay(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.defaultDelay()).to.equal(config.defaultDelay)

      // Update with owner
      await expect(main.connect(owner).setDefaultDelay(newValue))
        .to.emit(main, 'DefaultDelaySet')
        .withArgs(config.defaultDelay, newValue)

      // Check value was updated
      expect(await main.defaultDelay()).to.equal(newValue)
    })

    it('Should allow to update maxTradeSlippage if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await main.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

      // If not owner cannot update
      await expect(main.connect(other).setMaxTradeSlippage(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

      // Update with owner
      await expect(main.connect(owner).setMaxTradeSlippage(newValue))
        .to.emit(main, 'MaxTradeSlippageSet')
        .withArgs(config.maxTradeSlippage, newValue)

      // Check value was updated
      expect(await main.maxTradeSlippage()).to.equal(newValue)
    })

    it('Should allow to update dustAmount if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await main.dustAmount()).to.equal(config.dustAmount)

      // If not owner cannot update
      await expect(main.connect(other).setDustAmount(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.dustAmount()).to.equal(config.dustAmount)

      // Update with owner
      await expect(main.connect(owner).setDustAmount(newValue))
        .to.emit(main, 'DustAmountSet')
        .withArgs(config.dustAmount, newValue)

      // Check value was updated
      expect(await main.dustAmount()).to.equal(newValue)
    })

    it('Should allow to update backingBuffer if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await main.backingBuffer()).to.equal(config.backingBuffer)

      // If not owner cannot update
      await expect(main.connect(other).setBackingBuffer(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.backingBuffer()).to.equal(config.backingBuffer)

      // Update with owner
      await expect(main.connect(owner).setBackingBuffer(newValue))
        .to.emit(main, 'BackingBufferSet')
        .withArgs(config.backingBuffer, newValue)

      // Check value was updated
      expect(await main.backingBuffer()).to.equal(newValue)
    })

    it('Should allow to update issuanceRate if Owner', async () => {
      const newValue: BigNumber = fp('0.1')

      // Check existing value
      expect(await main.issuanceRate()).to.equal(config.issuanceRate)

      // If not owner cannot update
      await expect(main.connect(other).setIssuanceRate(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.issuanceRate()).to.equal(config.issuanceRate)

      // Update with owner
      await expect(main.connect(owner).setIssuanceRate(newValue))
        .to.emit(main, 'IssuanceRateSet')
        .withArgs(config.issuanceRate, newValue)

      // Check value was updated
      expect(await main.issuanceRate()).to.equal(newValue)
    })

    it('Should allow to update defaultThreshold if Owner', async () => {
      const newValue: BigNumber = fp('0.1')

      // Check existing value
      expect(await main.defaultThreshold()).to.equal(config.defaultThreshold)

      // If not owner cannot update
      await expect(main.connect(other).setDefaultThreshold(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.defaultThreshold()).to.equal(config.defaultThreshold)

      // Update with owner
      await expect(main.connect(owner).setDefaultThreshold(newValue))
        .to.emit(main, 'DefaultThresholdSet')
        .withArgs(config.defaultThreshold, newValue)

      // Check value was updated
      expect(await main.defaultThreshold()).to.equal(newValue)
    })

    it('Should allow to update stRSRPayRatio if Owner', async () => {
      const newValue: BigNumber = config.stRSRPayRatio.div(2)

      // Check existing value
      expect(await main.stRSRPayRatio()).to.equal(config.stRSRPayRatio)

      // If not owner cannot update
      await expect(main.connect(other).setStRSRPayRatio(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.stRSRPayRatio()).to.equal(config.stRSRPayRatio)

      // Update with owner
      await expect(main.connect(owner).setStRSRPayRatio(newValue))
        .to.emit(main, 'StRSRPayRatioSet')
        .withArgs(config.stRSRPayRatio, newValue)

      // Check value was updated
      expect(await main.stRSRPayRatio()).to.equal(newValue)
    })

    it('Should return nextRewards correctly', async () => {
      // Check next immediate reward
      expect(await main.nextRewards()).to.equal(config.rewardStart.add(config.rewardPeriod))

      // Advance time to get next reward
      await advanceTime(config.rewardPeriod.toString())

      // Check next reward date
      expect(await main.nextRewards()).to.equal(config.rewardStart.add(config.rewardPeriod.mul(2)))

      // Advance time to get next reward
      await advanceTime(config.rewardPeriod.mul(2).toString())

      // Check next reward date
      expect(await main.nextRewards()).to.equal(config.rewardStart.add(config.rewardPeriod.mul(4)))
    })

    it('Should return backing tokens', async () => {
      expect(await main.basketTokens()).to.eql([
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
      const newFurnace = <FurnaceP0>await FurnaceFactory.deploy(rToken.address, config.rewardPeriod)
      const invalidFurnace = <FurnaceP0>await FurnaceFactory.deploy(rToken.address, 0)

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

      // Ensure validation of reward period is checked
      // Should not be able to update to a furnace with different rewardPeriod
      await expect(
        main.connect(owner).setRevenueFurnace(invalidFurnace.address)
      ).to.be.revertedWith('does not match rewardPeriod')

      // Check furnace was not updated
      expect(await main.revenueFurnace()).to.equal(newFurnace.address)
    })
  })

  describe('Asset Registry', () => {
    it('Should allow to add Asset if Owner', async () => {
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
      const previousLength = (await main.registeredERC20s()).length

      // Cannot add asset if not owner
      await expect(main.connect(other).registerAsset(newAsset.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Nothing occurs if attempting to add an existing asset
      await main.connect(owner).registerAsset(aaveAsset.address)

      // Check nothing changed
      let allERC20s = await main.registeredERC20s()
      expect(allERC20s.length).to.equal(previousLength)

      // Add new asset
      await expect(main.connect(owner).registerAsset(newAsset.address))
        .to.emit(main, 'AssetRegistered')
        .withArgs(erc20s[5].address, newAsset.address)

      // Check it was added
      allERC20s = await main.registeredERC20s()
      expect(allERC20s).to.contain(erc20s[5].address)
      expect(allERC20s.length).to.equal(previousLength + 1)
    })

    it('Should allow to remove asset if Owner', async () => {
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
      const previousLength = (await main.registeredERC20s()).length

      // Check assets
      let allERC20s = await main.registeredERC20s()
      expect(allERC20s).to.contain(compToken.address)
      expect(allERC20s).to.not.contain(erc20s[5].address)

      // Cannot remove asset if not owner
      await expect(main.connect(other).unregisterAsset(compAsset.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Nothing occurs if attempting to remove an unexisting asset
      await main.connect(owner).unregisterAsset(newAsset.address)

      // Check nothing changed
      allERC20s = await main.registeredERC20s()
      expect(allERC20s.length).to.equal(previousLength)
      expect(allERC20s).to.contain(compToken.address)
      expect(allERC20s).to.not.contain(erc20s[5].address)

      // Remove asset
      await main.connect(owner).unregisterAsset(compAsset.address)

      // Check if it was removed
      allERC20s = await main.registeredERC20s()
      expect(allERC20s).to.not.contain(compToken.address)
      expect(allERC20s.length).to.equal(previousLength - 1)
    })

    //   it('Should allow to activate Asset if Owner and perform validations', async () => {
    //     // Get additional tokens and assets
    //     newToken = erc20s[2] // usdt
    //     newAsset = collateral[2] // usdt

    //     // Create asset on existing erc20
    //     const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAssetP0')
    //     const existingAsset: CompoundPricedAssetP0 = <CompoundPricedAssetP0>(
    //       await AssetFactory.deploy(token0.address, compoundMock.address)
    //     )

    //     // Get previous length for assets
    //     const previousLength = (await main.registeredERC20s()).length

    //     // Cannot activate asset if not owner
    //     await expect(main.connect(other).activateAsset(newAsset.address)).to.be.revertedWith(
    //       'Ownable: caller is not the owner'
    //     )

    //     // Cannot activate new asset if the ERC20 already in basket
    //     await expect(main.connect(owner).activateAsset(existingAsset.address)).to.be.revertedWith(
    //       'Token is in current basket'
    //     )

    //     // Check nothing changed
    //     let assets = await main.registeredERC20s()
    //     expect(assets.length).to.equal(previousLength)
    //     expect(assets).to.not.contain(erc20s[5].address)
    //     expect(assets).to.not.contain(existingAsset.address)

    //     // Activate new asset
    //     await expect(main.connect(owner).activateAsset(newAsset.address))
    //       .to.emit(main, 'AssetActivated')
    //       .withArgs(newAsset.address)

    //     // Check asset was added and activated
    //     assets = await main.registeredERC20s()
    //     expect(assets).to.contain(erc20s[5].address)
    //     expect(assets.length).to.equal(previousLength + 1)

    //     // Nothing occurs if attempting to activate again
    //     await expect(main.connect(owner).activateAsset(newAsset.address)).to.not.emit(
    //       main,
    //       'AssetActivated'
    //     )

    //     // No changes
    //     assets = await main.registeredERC20s()
    //     expect(assets).to.contain(erc20s[5].address)
    //     expect(assets.length).to.equal(previousLength + 1)
    //   })

    //   it('Should allow to deactivate Asset if Owner and perform validations', async () => {
    //     // Get previous length for assets
    //     const previousLength = (await main.registeredERC20s()).length

    //     // Cannot deactivate asset if not owner
    //     await expect(main.connect(other).deactivateAsset(compAsset.address)).to.be.revertedWith(
    //       'Ownable: caller is not the owner'
    //     )

    //     // Cannot activate asset if the ERC20 is in basket
    //     await expect(main.connect(owner).deactivateAsset(collateral0.address)).to.be.revertedWith(
    //       'Token is in current basket'
    //     )

    //     // Check nothing changed
    //     let assets = await main.registeredERC20s()
    //     expect(assets.length).to.equal(previousLength)
    //     expect(assets).to.contain(compToken.address)

    //     // Dectivate another asset
    //     await expect(main.connect(owner).deactivateAsset(compAsset.address))
    //       .to.emit(main, 'AssetDeactivated')
    //       .withArgs(compAsset.address)

    //     //  Check asset was deactivated but not removed
    //     assets = await main.registeredERC20s()
    //     expect(assets).to.not.contain(compToken.address)
    //     expect(assets.length).to.equal(previousLength - 1)

    //     // Check it was not removed from all assets
    //     let erc20s = await main.registeredERC20s()
    //     expect(erc20s).to.contain(compToken.address)

    //     // Nothing occurs if attempting to deactivate again
    //     await expect(main.connect(owner).deactivateAsset(compAsset.address)).to.not.emit(
    //       main,
    //       'AssetDeactivated'
    //     )

    //     // Nothing changed
    //     assets = await main.registeredERC20s()
    //     expect(assets).to.not.contain(compToken.address)
    //     expect(assets.length).to.equal(previousLength - 1)
    //   })

    //   it('Should allow to disable Collateral if Owner', async () => {
    //     // Check collateral is not disabled by default
    //     expect(await collateral2.status()).to.equal(CollateralStatus.SOUND)

    //     // Disable collateral
    //     await collateral2.connect(owner).disable()

    //     // Check Collateral disabled
    //     expect(await collateral2.status()).to.equal(CollateralStatus.DISABLED)

    //     // Cannot disable collateral if not owner
    //     await expect(collateral3.connect(other).disable()).to.be.revertedWith('main or its owner')
    //   })

    //   it('Should return all assets', async () => {
    //     const erc20s: string[] = await main.registeredERC20s()

    //     // Get addresses from all collateral
    //     const collateralAddrs: string[] = await Promise.all(
    //       collateral.map(async (c): Promise<string> => {
    //         return await c.address
    //       })
    //     )

    //     expect(erc20s[0]).to.equal(rTokenAsset.address)
    //     expect(erc20s[1]).to.equal(rsrAsset.address)
    //     expect(erc20s[2]).to.equal(aaveAsset.address)
    //     expect(erc20s[3]).to.equal(compAsset.address)
    //     expect(erc20s.slice(4)).to.eql(collateralAddrs)
    //   })
  })

  describe('Basket Handling', () => {
    it('Should not allow to set prime Basket if not Owner', async () => {
      await expect(
        main.connect(other).setPrimeBasket([collateral0.address], [fp('1')])
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should not allow to set prime Basket with invalid length', async () => {
      await expect(
        main.connect(owner).setPrimeBasket([collateral0.address], [])
      ).to.be.revertedWith('must be same length')
    })

    it('Should allow to set prime Basket if Owner', async () => {
      // Set basket
      await expect(main.connect(owner).setPrimeBasket([token0.address], [fp('1')]))
        .to.emit(main, 'PrimeBasketSet')
        .withArgs([token0.address], [fp('1')])
    })

    it('Should not allow to set backup Config if not Owner', async () => {
      await expect(
        main
          .connect(other)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should allow to set backup Config if Owner', async () => {
      // Set basket
      await expect(
        main
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
      )
        .to.emit(main, 'BackupConfigSet')
        .withArgs(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
    })

    it('Should not allow to switch basket if not Owner', async () => {
      await expect(main.connect(other).switchBasket()).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('Should allow to call switch Basket if Owner - No changes', async () => {
      // Switch basket - No backup nor default
      await expect(main.connect(owner).switchBasket()).to.emit(main, 'BasketSet')

      // Basket remains the same in this case
      expect(await main.fullyCapitalized()).to.equal(true)
      const backing = await main.basketTokens()
      expect(backing[0]).to.equal(token0.address)
      expect(backing[1]).to.equal(token1.address)
      expect(backing[2]).to.equal(token2.address)
      expect(backing[3]).to.equal(token3.address)

      expect(backing.length).to.equal(4)

      // Not updated so basket last changed is not set
(??)      expect(await main.blockBasketLastChanged()).to.be.gt(bn(0))
      expect(await main.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
      expect(await facade.totalAssetValue()).to.equal(0)
    })
  })
})
