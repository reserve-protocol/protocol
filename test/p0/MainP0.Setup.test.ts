import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Contract, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { AaveClaimAdapterP0 } from '../../typechain/AaveClaimAdapterP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AssetP0 } from '../../typechain/AssetP0'
import { ATokenFiatCollateralP0 } from '../../typechain/ATokenFiatCollateralP0'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { CompoundClaimAdapterP0 } from '../../typechain/CompoundClaimAdapterP0'
import { CompoundPricedAssetP0 } from '../../typechain/CompoundPricedAssetP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenFiatCollateralP0 } from '../../typechain/CTokenFiatCollateralP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { MainP0 } from '../../typechain/MainP0'
import { MarketMock } from '../../typechain/MarketMock'
import { RevenueTraderP0 } from '../../typechain/RevenueTraderP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { USDCMock } from '../../typechain/USDCMock'
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
  let collateral0: CollateralP0
  let collateral1: CollateralP0
  let collateral2: ATokenFiatCollateralP0
  let collateral3: CTokenFiatCollateralP0

  // Config values
  let config: IConfig
  let dist: IRevenueShare

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let rTokenAsset: RTokenAssetP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet
  let basket: Collateral[]

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    let erc20s: ERC20Mock[]
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

      // Assets and other components
      expect(await main.rsrAsset()).to.equal(rsrAsset.address)
      expect(await main.rTokenAsset()).to.equal(rTokenAsset.address)
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
      expect(await main.stRSRWithdrawalDelay()).to.equal(config.stRSRWithdrawalDelay)
      expect(await main.defaultDelay()).to.equal(config.defaultDelay)
      expect(await main.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await main.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await main.minAuctionSize()).to.equal(config.minAuctionSize)
      expect(await main.issuanceRate()).to.equal(config.issuanceRate)
      expect(await main.defaultThreshold()).to.equal(config.defaultThreshold)
    })

    it('Should register Assets correctly', async () => {
      // RSR
      expect(await main.rsrAsset()).to.equal(rsrAsset.address)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await main.rsr()).to.equal(rsr.address)

      // RToken
      expect(await main.rTokenAsset()).to.equal(rTokenAsset.address)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.rToken()).to.equal(rToken.address)

      // Check assets/collateral
      const activeAssets = await main.activeAssets()
      expect(activeAssets[0]).to.equal(rTokenAsset.address)
      expect(activeAssets[1]).to.equal(rsrAsset.address)
      expect(activeAssets[2]).to.equal(aaveAsset.address)
      expect(activeAssets[3]).to.equal(compAsset.address)
      expect(activeAssets.length).to.eql((await main.basketCollateral()).length + 4)
    })

    it('Should register Basket correctly', async () => {
      // Basket
      expect(await main.fullyCapitalized()).to.equal(true)
      const backing = await main.basketCollateral()
      expect(backing[0]).to.equal(collateral0.address)
      expect(backing[1]).to.equal(collateral1.address)
      expect(backing[2]).to.equal(collateral2.address)
      expect(backing[3]).to.equal(collateral3.address)

      expect(backing.length).to.equal(4)

      // Check other values
      expect(await main.blockBasketLastChanged()).to.be.gt(bn(0))
      expect(await main.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
      expect(await main.totalAssetValue()).to.equal(0)

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
        claimAdapters: [compoundClaimer.address, aaveClaimer.address],
      }
      await expect(main.init(ctorArgs)).to.be.revertedWith('already initialized')
    })

    it('Should not allow to poke if Main is not initialized', async () => {
      const MainFactory: ContractFactory = await ethers.getContractFactory('MainP0')
      const newMain: MainP0 = <MainP0>await MainFactory.deploy()
      await newMain.connect(owner).unpause()
      await expect(newMain.poke()).to.be.revertedWith('not initialized')
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
      await main.connect(owner).setRewardStart(newValue)

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
      await main.connect(owner).setRewardPeriod(newValue)

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
      await main.connect(owner).setAuctionPeriod(newValue)

      // Check value was updated
      expect(await main.auctionPeriod()).to.equal(newValue)
    })

    it('Should allow to update stRSRWithdrawalDelay if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await main.stRSRWithdrawalDelay()).to.equal(config.stRSRWithdrawalDelay)

      // If not owner cannot update
      await expect(main.connect(other).setStRSRWithdrawalDelay(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.stRSRWithdrawalDelay()).to.equal(config.stRSRWithdrawalDelay)

      // Update with owner
      await main.connect(owner).setStRSRWithdrawalDelay(newValue)

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
      await main.connect(owner).setDefaultDelay(newValue)

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
      await main.connect(owner).setMaxTradeSlippage(newValue)

      // Check value was updated
      expect(await main.maxTradeSlippage()).to.equal(newValue)
    })

    it('Should allow to update maxAuctionSize if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await main.maxAuctionSize()).to.equal(config.maxAuctionSize)

      // If not owner cannot update
      await expect(main.connect(other).setMaxAuctionSize(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.maxAuctionSize()).to.equal(config.maxAuctionSize)

      // Update with owner
      await main.connect(owner).setMaxAuctionSize(newValue)

      // Check value was updated
      expect(await main.maxAuctionSize()).to.equal(newValue)
    })

    it('Should allow to update minAuctionSize if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await main.minAuctionSize()).to.equal(config.minAuctionSize)

      // If not owner cannot update
      await expect(main.connect(other).setMinAuctionSize(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.minAuctionSize()).to.equal(config.minAuctionSize)

      // Update with owner
      await main.connect(owner).setMinAuctionSize(newValue)

      // Check value was updated
      expect(await main.minAuctionSize()).to.equal(newValue)
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
      await main.connect(owner).setIssuanceRate(newValue)

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
      await main.connect(owner).setDefaultThreshold(newValue)

      // Check value was updated
      expect(await main.defaultThreshold()).to.equal(newValue)
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
      expect(await main.basketCollateral()).to.eql([
        collateral0.address,
        collateral1.address,
        collateral2.address,
        collateral3.address,
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
      await main.connect(owner).setMarket(other.address)

      // Check value was updated
      expect(await main.market()).to.equal(other.address)
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
      await main.connect(owner).addClaimAdapter(other.address)

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
      await main.connect(owner).removeClaimAdapter(compoundClaimer.address)

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
      await main.connect(owner).setRevenueFurnace(newFurnace.address)

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
        await AssetFactory.deploy(token0.address, compoundMock.address)
      )

      // Get previous length for assets
      const previousLength = (await main.activeAssets()).length

      // Cannot add asset if not owner
      await expect(main.connect(other).addAsset(newAsset.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check nothing changed
      let activeAssets = await main.activeAssets()
      expect(activeAssets.length).to.equal(previousLength)

      // Add new asset
      await expect(main.connect(owner).addAsset(newAsset.address))
        .to.emit(main, 'AssetAdded')
        .withArgs(newAsset.address)
    })

    it('Should allow to remove asset if Owner', async () => {
      // Get previous length for assets
      const previousLength = (await main.activeAssets()).length

      // Cannot remove asset if not owner
      await expect(main.connect(other).removeAsset(compAsset.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check nothing changed
      let activeAssets = await main.activeAssets()
      expect(activeAssets.length).to.equal(previousLength)
      expect(activeAssets).to.contain(compAsset.address)

      // Remove asset
      await main.connect(owner).removeAsset(compAsset.address)

      // Check if it was removed
      activeAssets = await main.activeAssets()
      expect(activeAssets).to.not.contain(compAsset.address)
      expect(activeAssets.length).to.equal(previousLength - 1)
    })

    it('Should allow to disable Collateral if Owner', async () => {
      // Check collateral is not disabled by default
      expect(await collateral2.status()).to.equal(CollateralStatus.SOUND)

      // Disable collateral
      await collateral2.connect(owner).disable()

      // Check Collateral disabled
      expect(await collateral2.status()).to.equal(CollateralStatus.DISABLED)

      // Cannot disable collateral if not owner
      await expect(collateral3.connect(other).disable()).to.be.revertedWith('main or its owner')
    })
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
      await expect(main.connect(owner).setPrimeBasket([collateral0.address], [fp('1')]))
        .to.emit(main, 'PrimeBasketSet')
        .withArgs([collateral0.address], [fp('1')])
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
      const backing = await main.basketCollateral()
      expect(backing[0]).to.equal(collateral0.address)
      expect(backing[1]).to.equal(collateral1.address)
      expect(backing[2]).to.equal(collateral2.address)
      expect(backing[3]).to.equal(collateral3.address)

      expect(backing.length).to.equal(4)

      // Not updated so basket last changed is not set
      expect(await main.blockBasketLastChanged()).to.be.gt(bn(0))
      expect(await main.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
      expect(await main.totalAssetValue()).to.equal(0)
    })
  })
})
