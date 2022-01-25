import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracle } from '../../typechain/AaveOracle'
import { AssetP0 } from '../../typechain/AssetP0'
import { ATokenCollateralP0 } from '../../typechain/ATokenCollateralP0'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { CompoundOracle } from '../../typechain/CompoundOracle'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenCollateralP0 } from '../../typechain/CTokenCollateralP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { MainP0 } from '../../typechain/MainP0'
import { MarketMock } from '../../typechain/MarketMock'
import { RevenueTraderP0 } from '../../typechain/RevenueTraderP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
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

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: AssetP0
  let compToken: ERC20Mock
  let compAsset: AssetP0
  let compoundMock: ComptrollerMockP0
  let compoundOracle: CompoundOracle
  let aaveToken: ERC20Mock
  let aaveAsset: AssetP0
  let aaveMock: AaveLendingPoolMockP0
  let aaveOracle: AaveOracle

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
  let collateral2: ATokenCollateralP0
  let collateral3: CTokenCollateralP0

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

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    let erc20s: ERC20Mock[]
    let basket: Collateral[]
      // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      aaveToken,
      compAsset,
      aaveAsset,
      compoundOracle,
      aaveOracle,
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
    } = await loadFixture(defaultFixture))
    token0 = erc20s[collateral.indexOf(basket[0])]
    token1 = erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    // Set Aave revenue token
    await token2.setAaveToken(aaveToken.address)

    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = <ATokenCollateralP0>basket[2]
    collateral3 = <CTokenCollateralP0>basket[3]

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
      expect(await main.compAsset()).to.equal(compAsset.address)
      expect(await main.aaveAsset()).to.equal(aaveAsset.address)
      expect(await main.rTokenAsset()).to.equal(rTokenAsset.address)
      expect(await main.stRSR()).to.equal(stRSR.address)
      expect(await main.revenueFurnace()).to.equal(furnace.address)
      expect(await main.market()).to.equal(market.address)

      // Configuration
      expect(await main.rsrCut()).to.equal(fp('0.6'))
      expect(await main.rTokenCut()).to.equal(fp('0.4'))
      expect(await main.rewardStart()).to.equal(config.rewardStart)
      expect(await main.rewardPeriod()).to.equal(config.rewardPeriod)
      expect(await main.auctionPeriod()).to.equal(config.auctionPeriod)
      expect(await main.stRSRWithdrawalDelay()).to.equal(config.stRSRWithdrawalDelay)
      expect(await main.defaultDelay()).to.equal(config.defaultDelay)
      expect(await main.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await main.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await main.minRecapitalizationAuctionSize()).to.equal(
        config.minRecapitalizationAuctionSize
      )
      expect(await main.minRevenueAuctionSize()).to.equal(config.minRevenueAuctionSize)
      expect(await main.migrationChunk()).to.equal(config.migrationChunk)
      expect(await main.issuanceRate()).to.equal(config.issuanceRate)
      expect(await main.defaultThreshold()).to.equal(config.defaultThreshold)
    })

    it('Should register Assets correctly', async () => {
      // RSR
      expect(await main.rsrAsset()).to.equal(rsrAsset.address)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await main.rsr()).to.equal(rsr.address)

      // Comp
      expect(await main.compAsset()).to.equal(compAsset.address)
      expect(await compAsset.erc20()).to.equal(compToken.address)

      // Aave
      expect(await main.aaveAsset()).to.equal(aaveAsset.address)
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)

      // RToken
      expect(await main.rTokenAsset()).to.equal(rTokenAsset.address)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.rToken()).to.equal(rToken.address)

      // Check assets/collateral
      const allAssets = await main.allAssets()
      expect(allAssets[0]).to.equal(rTokenAsset.address)
      expect(allAssets[1]).to.equal(rsrAsset.address)
      expect(allAssets[2]).to.equal(compAsset.address)
      expect(allAssets[3]).to.equal(aaveAsset.address)
      expect(allAssets.slice(4)).to.eql(collateral.map((c) => c.address))
    })

    it('Should register Basket correctly', async () => {
      // Basket
      expect(await main.fullyCapitalized()).to.equal(true)
      expect((await main.backingTokens()).length).to.equal(4)
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

  describe.only('Configuration/State', () => {
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

    it.skip('Should allow to update rewardPeriod if Owner', async () => {
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

    it('Should allow to update minRecapitalizationAuctionSize if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await main.minRecapitalizationAuctionSize()).to.equal(
        config.minRecapitalizationAuctionSize
      )

      // If not owner cannot update
      await expect(
        main.connect(other).setMinRecapitalizationAuctionSize(newValue)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Check value did not change
      expect(await main.minRecapitalizationAuctionSize()).to.equal(
        config.minRecapitalizationAuctionSize
      )

      // Update with owner
      await main.connect(owner).setMinRecapitalizationAuctionSize(newValue)

      // Check value was updated
      expect(await main.minRecapitalizationAuctionSize()).to.equal(newValue)
    })

    it('Should allow to update minRevenueAuctionSize if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await main.minRevenueAuctionSize()).to.equal(config.minRevenueAuctionSize)

      // If not owner cannot update
      await expect(main.connect(other).setMinRevenueAuctionSize(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.minRevenueAuctionSize()).to.equal(config.minRevenueAuctionSize)

      // Update with owner
      await main.connect(owner).setMinRevenueAuctionSize(newValue)

      // Check value was updated
      expect(await main.minRevenueAuctionSize()).to.equal(newValue)
    })

    it('Should allow to update migrationChunk if Owner', async () => {
      const newValue: BigNumber = fp('0.5')

      // Check existing value
      expect(await main.migrationChunk()).to.equal(config.migrationChunk)

      // If not owner cannot update
      await expect(main.connect(other).setMigrationChunk(newValue)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.migrationChunk()).to.equal(config.migrationChunk)

      // Update with owner
      await main.connect(owner).setMigrationChunk(newValue)

      // Check value was updated
      expect(await main.migrationChunk()).to.equal(newValue)
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
      expect(await main.backingTokens()).to.eql([
        await collateral0.erc20(),
        await collateral1.erc20(),
        await collateral2.erc20(),
        await collateral3.erc20(),
      ])
    })
  })

  describe('Asset Registry', () => {
    it('Should allow to disable Collateral if Owner', async () => {
      // Check collateral is not disabled by default
      expect(await collateral2.status()).to.equal(CollateralStatus.SOUND)

      // Disable collateral
      await main.connect(owner).disableCollateral(collateral2.address)

      // Check Collateral disabled
      expect(await collateral2.status()).to.equal(CollateralStatus.DISABLED)

      // Cannot disable collateral if not owner
      await expect(main.connect(other).disableCollateral(collateral3.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })
  })
})
