import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import {
  BN_SCALE_FACTOR,
  FURNACE_DEST,
  Mood,
  STRSR_DEST,
  ZERO_ADDRESS,
} from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { AToken } from '../../typechain/AToken'
import { ATokenCollateralP0 } from '../../typechain/ATokenCollateralP0'
import { BackingTraderP0 } from '../../typechain/BackingTraderP0'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenCollateralP0 } from '../../typechain/CTokenCollateralP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { MainP0 } from '../../typechain/MainP0'
import { MarketMock } from '../../typechain/MarketMock'
import { RevenueTraderP0 } from '../../typechain/RevenueTraderP0'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { TraderP0 } from '../../typechain/TraderP0'
import { USDCMock } from '../../typechain/USDCMock'
import { VaultP0 } from '../../typechain/VaultP0'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig, IRevenueShare } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

enum AuctionStatus {
  NOT_YET_OPEN,
  OPEN,
  DONE,
}

interface IAuctionInfo {
  sell: string
  buy: string
  sellAmount: BigNumber
  minBuyAmount: BigNumber
  startTime: number
  endTime: number
  clearingSellAmount: BigNumber
  clearingBuyAmount: BigNumber
  externalAuctionId: BigNumber
  status: AuctionStatus
}

describe('MainP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Vault and Assets
  let collateral: Collateral[]
  let VaultFactory: ContractFactory
  let vault: VaultP0

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: RSRAssetP0
  let compAsset: COMPAssetP0
  let compoundMock: ComptrollerMockP0
  let compoundOracle: CompoundOracleMockP0
  let aaveAsset: AAVEAssetP0
  let aaveMock: AaveLendingPoolMockP0
  let aaveOracle: AaveOracleMockP0

  // Trading
  let market: MarketMock
  let rsrStakingTrader: RevenueTraderP0
  let rTokenMeltingTrader: RevenueTraderP0
  let backingTrader: BackingTraderP0

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
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  const expectAuctionInfo = async (
    trader: TraderP0,
    index: number,
    auctionInfo: Partial<IAuctionInfo>
  ) => {
    const {
      sell,
      buy,
      sellAmount,
      minBuyAmount,
      startTime,
      endTime,
      clearingSellAmount,
      clearingBuyAmount,
      status,
    } = await trader.auctions(index)
    expect(sell).to.equal(auctionInfo.sell)
    expect(buy).to.equal(auctionInfo.buy)
    expect(sellAmount).to.equal(auctionInfo.sellAmount)
    expect(minBuyAmount).to.equal(auctionInfo.minBuyAmount)
    expect(startTime).to.equal(auctionInfo.startTime)
    expect(endTime).to.equal(auctionInfo.endTime)
    expect(clearingSellAmount).to.equal(auctionInfo.clearingSellAmount)
    expect(clearingBuyAmount).to.equal(auctionInfo.clearingBuyAmount)
    expect(status).to.equal(auctionInfo.status)
  }

  const expectAuctionStatus = async (
    trader: TraderP0,
    index: number,
    expectedStatus: AuctionStatus
  ) => {
    const { status } = await trader.auctions(index)
    expect(status).to.equal(expectedStatus)
  }

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
      compAsset,
      aaveAsset,
      compoundOracle,
      aaveOracle,
      compoundMock,
      aaveMock,
      erc20s,
      collateral,
      basket,
      vault,
      config,
      deployer,
      dist,
      main,
      rToken,
      furnace,
      stRSR,
      market,
    } = await loadFixture(defaultFixture))
    token0 = erc20s[collateral.indexOf(basket[0])]
    token1 = erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = <ATokenCollateralP0>basket[2]
    collateral3 = <CTokenCollateralP0>basket[3]

    rsrStakingTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rsrStakingTrader())
    )
    rTokenMeltingTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rTokenMeltingTrader())
    )
    rTokenMeltingTrader = <BackingTraderP0>(
      await ethers.getContractAt('BackingTraderP0', await main.backingTrader())
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

    // Set Vault Factory (for creating additional vaults in tests)
    VaultFactory = await ethers.getContractFactory('VaultP0')

    // Setup Main
    await vault.connect(owner).setMain(main.address)
  })

  describe('Deployment', () => {
    it('Should setup Main correctly', async () => {
      expect(await main.paused()).to.equal(false)
      expect(await main.owner()).to.equal(owner.address)
      expect(await main.pauser()).to.equal(owner.address)
      expect(await main.mood()).to.equal(Mood.CALM)
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
      expect(await main.stRSR()).to.equal(stRSR.address)
      expect(await main.revenueFurnace()).to.equal(furnace.address)
      const rTokenAsset = await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.rsrAsset()).to.equal(rsrAsset.address)
      expect(await main.compAsset()).to.equal(compAsset.address)
      expect(await main.aaveAsset()).to.equal(aaveAsset.address)
      expect((await main.oracle()).toString()).to.equal(
        [compoundMock.address, aaveMock.address].toString()
      )
      expect(await main.market()).to.equal(market.address)
      expect(await main.rToken()).to.equal(rToken.address)
      expect(await main.rsr()).to.equal(rsr.address)
      expect(await main.fullyCapitalized()).to.equal(true)
      expect(await main.vault()).to.equal(vault.address)
      expect(await main.numVaults()).to.equal(1)
      expect(await main.getBackingTrader()).to.not.equal(ZERO_ADDRESS)
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

  describe('Configuration/Mood', () => {
    // TODO: Check that owner can set settings

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

  describe('Issuance and Slow Minting', function () {
    it('Should not issue RTokens if paused', async function () {
      const issueAmount: BigNumber = bn('10e18')

      // Pause Main
      await main.connect(owner).pause()

      // Try to issue
      await expect(main.connect(addr1).issue(issueAmount)).to.be.revertedWith('paused')

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
      //expect(await main.issuances(0)).to.be.empty
    })

    it('Should not issue RTokens if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Try to issue
      await expect(main.connect(addr1).issue(zero)).to.be.revertedWith('Cannot issue zero')

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn('0'))
      expect(await vault.basketUnits(main.address)).to.equal(0)
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const issueAmount: BigNumber = bn('10e18')

      await expect(main.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await vault.basketUnits(main.address)).to.equal(0)
    })

    it('Should revert if user does not have the required Tokens', async function () {
      const issueAmount: BigNumber = bn('10000000000e18')

      await expect(main.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
      expect(await rToken.totalSupply()).to.equal(bn('0'))
      expect(await vault.basketUnits(main.address)).to.equal(0)
    })

    it('Should issue RTokens with single basket token', async function () {
      const issueAmount: BigNumber = bn('10e18')
      const qty: BigNumber = bn('1e18')
      const newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([collateral[0].address], [qty], [])
      )

      // Update Vault
      await main.connect(owner).switchVault(newVault.address)

      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)

      // check balances before
      expect(await token0.balanceOf(newVault.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Check Balances after
      expect(await token0.balanceOf(newVault.address)).to.equal(issueAmount)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount))
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await newVault.basketUnits(main.address)).to.equal(issueAmount)

      // Check if minting was registered
      const currentBlockNumber = await ethers.provider.getBlockNumber()
      const [sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(0)
      expect(sm_vault).to.equal(newVault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_at).to.equal(currentBlockNumber + 1)
      expect(sm_proc).to.equal(false)
    })

    it('Should issue RTokens correctly for more complex basket multiple users', async function () {
      const issueAmount: BigNumber = bn('10e18')

      const expectedTkn0: BigNumber = issueAmount
        .mul(await vault.quantity(collateral0.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn1: BigNumber = issueAmount
        .mul(await vault.quantity(collateral1.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn2: BigNumber = issueAmount
        .mul(await vault.quantity(collateral2.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn3: BigNumber = issueAmount
        .mul(await vault.quantity(collateral3.address))
        .div(BN_SCALE_FACTOR)

      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // check balances before
      expect(await token0.balanceOf(vault.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token1.balanceOf(vault.address)).to.equal(0)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token2.balanceOf(vault.address)).to.equal(0)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token3.balanceOf(vault.address)).to.equal(0)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Check Balances after
      expect(await token0.balanceOf(vault.address)).to.equal(expectedTkn0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))

      expect(await token1.balanceOf(vault.address)).to.equal(expectedTkn1)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))

      expect(await token2.balanceOf(vault.address)).to.equal(expectedTkn2)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))

      expect(await token3.balanceOf(vault.address)).to.equal(expectedTkn3)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Check if minting was registered
      let currentBlockNumber = await ethers.provider.getBlockNumber()
      let [sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(0)
      expect(sm_vault).to.equal(vault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_at).to.equal(currentBlockNumber + 1)
      expect(sm_proc).to.equal(false)

      // Issue new RTokens with different user
      // This will also process the previous minting and send funds to the minter
      // Provide approvals
      await token0.connect(addr2).approve(main.address, initialBal)
      await token1.connect(addr2).approve(main.address, initialBal)
      await token2.connect(addr2).approve(main.address, initialBal)
      await token3.connect(addr2).approve(main.address, initialBal)
      await main.poke()

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Issue rTokens
      await main.connect(addr2).issue(issueAmount)

      // Check Balances after
      expect(await token0.balanceOf(vault.address)).to.equal(expectedTkn0.mul(2))
      expect(await token1.balanceOf(vault.address)).to.equal(expectedTkn1.mul(2))
      expect(await token2.balanceOf(vault.address)).to.equal(expectedTkn2.mul(2))
      expect(await token3.balanceOf(vault.address)).to.equal(expectedTkn3.mul(2))
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(addr2.address)).to.equal(0)

      // Check new issuances was processed
      ;[sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(1)
      expect(sm_vault).to.equal(vault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr2.address)
      //expect(sm_at).to.equal()
      expect(sm_proc).to.equal(false)
    })

    it('Should process issuances in multiple attempts (using minimum issuance)', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      const expectedTkn0: BigNumber = issueAmount
        .mul(await vault.quantity(collateral0.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn1: BigNumber = issueAmount
        .mul(await vault.quantity(collateral1.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn2: BigNumber = issueAmount
        .mul(await vault.quantity(collateral2.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn3: BigNumber = issueAmount
        .mul(await vault.quantity(collateral3.address))
        .div(BN_SCALE_FACTOR)

      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Check Balances after
      expect(await token0.balanceOf(vault.address)).to.equal(expectedTkn0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))

      expect(await token1.balanceOf(vault.address)).to.equal(expectedTkn1)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))

      expect(await token2.balanceOf(vault.address)).to.equal(expectedTkn2)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))

      expect(await token3.balanceOf(vault.address)).to.equal(expectedTkn3)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Check if minting was registered
      let currentBlockNumber = await ethers.provider.getBlockNumber()
      let [sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(0)
      expect(sm_vault).to.equal(vault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_at).to.equal(currentBlockNumber + 5)
      expect(sm_proc).to.equal(false)

      // Process slow issuances
      await main.poke()

      // Check previous minting was not processed
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(false)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Process 4 blocks
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await main.poke()

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)
    })

    it('Should process issuances in multiple attempts (using issuanceRate)', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Process slow issuances
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await main.poke()

      // Check issuance was confirmed
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Set issuance rate to 50% per block
      // Set Max auction to 100%  and migration chunk to 100% to do it in one single redemption and auction

      // Update config
      main.connect(owner).setIssuanceRate(fp('0.5'))

      // Try new issuance. Should be based on issuance rate = 50% per block should take two blocks
      // Based on current supply its gonna be 25000e18 tokens per block
      const newIssuanceAmt: BigNumber = bn('30000e18')

      // Issue rTokens
      await main.connect(addr1).issue(newIssuanceAmt)

      // Check if minting was registered
      let currentBlockNumber = await ethers.provider.getBlockNumber()
      let [sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(1)
      expect(sm_vault).to.equal(vault.address)
      expect(sm_amt).to.equal(newIssuanceAmt)
      expect(sm_bu).to.equal(newIssuanceAmt)
      expect(sm_minter).to.equal(addr1.address)
      // Using issuance rate of 50% = 2 blocks
      expect(sm_at).to.equal(currentBlockNumber + 2)
      expect(sm_proc).to.equal(false)

      // Process slow issuances
      await main.poke()

      // Check previous minting was not processed
      ;[, , , , , sm_proc] = await main.issuances(1)
      expect(sm_proc).to.equal(false)
      expect(await rToken.totalSupply()).to.equal(issueAmount.add(newIssuanceAmt))
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount.add(newIssuanceAmt))
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Process slow mintings one more time
      await main.poke()

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await main.issuances(1)
      expect(sm_proc).to.equal(true)
      expect(await rToken.totalSupply()).to.equal(issueAmount.add(newIssuanceAmt))
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssuanceAmt))
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount.add(newIssuanceAmt))
    })

    it('Should process multiple issuances in the correct order', async function () {
      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // Issuance #1 -  Will be processed in 5 blocks
      const issueAmount: BigNumber = bn('50000e18')
      await main.connect(addr1).issue(issueAmount)

      // Issuance #2 and #3 - Will be processed in one additional block each
      const newIssueAmount: BigNumber = bn('10000e18')
      await main.connect(addr1).issue(newIssueAmount)
      await main.connect(addr1).issue(newIssueAmount)

      // Process remaining 3 blocks for first issuance (2 already processed by issue calls)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await main.poke()

      // Check first slow minting is confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount.add(newIssueAmount.mul(2)))

      // Process another block to get the 2nd issuance processed
      await main.poke()

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount))
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount.add(newIssueAmount.mul(2)))

      // Process another block to get the 3rd issuance processed
      await main.poke()

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount.mul(2)))
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount.add(newIssueAmount.mul(2)))
    })

    it('Should rollback mintings if Vault changes (2 blocks)', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      const expectedTkn0: BigNumber = issueAmount
        .mul(await vault.quantity(collateral0.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn1: BigNumber = issueAmount
        .mul(await vault.quantity(collateral1.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn2: BigNumber = issueAmount
        .mul(await vault.quantity(collateral2.address))
        .div(BN_SCALE_FACTOR)
      const expectedTkn3: BigNumber = issueAmount
        .mul(await vault.quantity(collateral3.address))
        .div(BN_SCALE_FACTOR)

      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Check Balances - Before vault switch
      expect(await token0.balanceOf(vault.address)).to.equal(expectedTkn0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))

      expect(await token1.balanceOf(vault.address)).to.equal(expectedTkn1)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))

      expect(await token2.balanceOf(vault.address)).to.equal(expectedTkn2)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))

      expect(await token3.balanceOf(vault.address)).to.equal(expectedTkn3)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Process slow issuances
      await main.poke()

      // Check previous minting was not processed
      let [, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(false)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Process slow mintings 1 time (still more pending).
      await main.poke()

      // Change Vault
      const newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([collateral[1].address], [bn('1e18')], [])
      )
      expect(await main.connect(owner).switchVault(newVault.address))
        .to.emit(main, 'IssuanceCanceled')
        .withArgs(0)

      // Check Balances after - Funds returned to minter
      expect(await token0.balanceOf(vault.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token1.balanceOf(vault.address)).to.equal(0)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token2.balanceOf(vault.address)).to.equal(0)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token3.balanceOf(vault.address)).to.equal(0)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await vault.basketUnits(main.address)).to.equal(0)
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Nothing sent to the AssetManager
      expect(await vault.basketUnits(main.address)).to.equal(0)
      expect(await newVault.basketUnits(main.address)).to.equal(0)
    })
  })

  describe('Redeem', function () {
    it('Should revert if zero amount', async function () {
      const zero: BigNumber = bn('0')
      await expect(main.connect(addr1).redeem(zero)).to.be.revertedWith('Cannot redeem zero')
    })

    it('Should revert if no balance of RToken', async function () {
      const redeemAmount: BigNumber = bn('1000e18')

      await expect(main.connect(addr1).redeem(redeemAmount)).to.be.revertedWith(
        'ERC20: burn amount exceeds balance'
      )
    })

    context('With issued RTokens', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')
        // Provide approvals
        await token0.connect(addr1).approve(main.address, initialBal)
        await token1.connect(addr1).approve(main.address, initialBal)
        await token2.connect(addr1).approve(main.address, initialBal)
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Process the issuance
        await main.poke()
      })

      it('Should redeem RTokens correctly', async function () {
        const redeemAmount = bn('100e18')

        // Check balances
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)
        expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

        // Redeem rTokens
        await main.connect(addr1).redeem(redeemAmount)

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)
      })

      it('Should redeem RTokens correctly for multiple users', async function () {
        const issueAmount = bn('100e18')
        const redeemAmount = bn('100e18')

        //Issue new RTokens
        await token0.connect(addr2).approve(main.address, initialBal)
        await token1.connect(addr2).approve(main.address, initialBal)
        await token2.connect(addr2).approve(main.address, initialBal)
        await token3.connect(addr2).approve(main.address, initialBal)

        //Issue rTokens
        await main.connect(addr2).issue(issueAmount)

        // Process the issuance
        await main.poke()

        // Redeem rTokens
        await main.connect(addr1).redeem(redeemAmount)

        // Redeem rTokens with another user
        await main.connect(addr2).redeem(redeemAmount)

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(addr2.address)).to.equal(0)

        expect(await rToken.totalSupply()).to.equal(0)

        expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

        expect(await token0.balanceOf(addr2.address)).to.equal(initialBal)
        expect(await token1.balanceOf(addr2.address)).to.equal(initialBal)
        expect(await token2.balanceOf(addr2.address)).to.equal(initialBal)
        expect(await token3.balanceOf(addr2.address)).to.equal(initialBal)
      })
    })
  })

  describe('Notice Default', function () {
    let issueAmount: BigNumber

    beforeEach(async function () {
      // Issue some RTokens to user
      issueAmount = bn('100e18')
      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Process the issuance
      await main.poke()
    })

    it('Should not detect default and not impact state in normal situation', async () => {
      expect(await main.mood()).to.equal(Mood.CALM)
      expect(await main.fullyCapitalized()).to.equal(true)

      // Notice default
      await expect(main.poke()).to.not.emit

      expect(await main.mood()).to.equal(Mood.CALM)
      expect(await main.fullyCapitalized()).to.equal(true)
    })

    it('Should detect soft default and change state', async () => {
      expect(await main.mood()).to.equal(Mood.CALM)
      expect(await main.fullyCapitalized()).to.equal(true)

      // Default one of the tokens - reduce fiatcoin price in terms of Eth
      await aaveOracle.setPrice(token0.address, bn('1.5e14'))

      // Notice default
      await expect(main.poke()).to.emit(main, 'MoodChanged').withArgs(Mood.CALM, Mood.DOUBT)

      expect(await main.mood()).to.equal(Mood.DOUBT)
      expect(await main.fullyCapitalized()).to.equal(true)

      // If soft default is reversed goes back to calm state
      await aaveOracle.setPrice(token0.address, bn('2.5e14'))

      // Notice default
      await expect(main.poke()).to.emit(main, 'MoodChanged').withArgs(Mood.DOUBT, Mood.CALM)

      expect(await main.mood()).to.equal(Mood.CALM)
      expect(await main.fullyCapitalized()).to.equal(true)
    })

    it('Should switch vaults and start Trading if in "doubt" more than defaultDelay', async () => {
      // Set backup vault
      const backupVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy(
          [collateral[1].address, collateral[2].address],
          [bn('1e6'), bn('1e18')],
          []
        )
      )
      await vault.setBackups([backupVault.address])

      expect(await main.mood()).to.equal(Mood.CALM)
      expect(await main.vault()).to.equal(vault.address)
      expect(await main.fullyCapitalized()).to.equal(true)

      // Default one of the tokens - reduce fiatcoin price in terms of Eth
      await aaveOracle.setPrice(token0.address, bn('1.5e14'))

      // Notice default
      await expect(main.poke()).to.emit(main, 'MoodChanged').withArgs(Mood.CALM, Mood.DOUBT)

      expect(await main.mood()).to.equal(Mood.DOUBT)
      expect(await main.vault()).to.equal(vault.address)
      expect(await main.fullyCapitalized()).to.equal(true)

      // Advancing time still before defaultDelay - No change should occur
      await advanceTime(3600)

      // Notice default
      await expect(main.poke()).to.not.emit

      expect(await main.mood()).to.equal(Mood.DOUBT)
      expect(await main.vault()).to.equal(vault.address)
      expect(await main.fullyCapitalized()).to.equal(true)

      // Advance time post defaultDelay
      await advanceTime(config.defaultDelay.toString())

      await expect(main.poke()).to.emit(main, 'MoodChanged').withArgs(Mood.DOUBT, Mood.TRADING)

      // Check state
      expect(await main.mood()).to.equal(Mood.TRADING)
      expect(await main.vault()).to.equal(backupVault.address)
      expect(await main.fullyCapitalized()).to.equal(false)

      // If token enters a soft default and then its restored, it should still keep Trading stat
      await aaveOracle.setPrice(token0.address, bn('2.5e14'))
      await aaveOracle.setPrice(token1.address, bn('0.5e14'))

      // Notice default
      await expect(main.poke()).to.emit(main, 'MoodChanged').withArgs(Mood.TRADING, Mood.DOUBT)

      // Restore price
      await aaveOracle.setPrice(token1.address, bn('2.5e14'))

      await expect(main.poke()).to.emit(main, 'MoodChanged').withArgs(Mood.DOUBT, Mood.TRADING)

      expect(await main.mood()).to.equal(Mood.TRADING)
      expect(await main.vault()).to.equal(backupVault.address)
      expect(await main.fullyCapitalized()).to.equal(false)
    })

    it('Should detect hard default and switch state and vault', async () => {
      // Define AToken
      const ATokenMockFactory = await ethers.getContractFactory('StaticATokenMock')
      const aToken0 = <StaticATokenMock>(
        await ATokenMockFactory.deploy('AToken 0', 'ATKN0', token0.address)
      )
      const aToken1 = <StaticATokenMock>(
        await ATokenMockFactory.deploy('AToken 1', 'ATKN1', token1.address)
      )
      const ATokenAssetFactory = await ethers.getContractFactory('ATokenCollateralP0')
      const assetAToken0 = <ATokenCollateralP0>await ATokenAssetFactory.deploy(aToken0.address)
      const assetAToken1 = <ATokenCollateralP0>await ATokenAssetFactory.deploy(aToken1.address)

      // Check state
      expect(await main.mood()).to.equal(Mood.CALM)
      expect(await main.vault()).to.equal(vault.address)
      expect(await main.fullyCapitalized()).to.equal(true)

      // Setup new Vault with AToken and capitalize Vault
      const backupVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([assetAToken1.address], [bn('1e18')], [])
      )
      const newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([assetAToken0.address], [bn('1e18')], [backupVault.address])
      )

      // Approve new collateral
      await main.connect(owner).approveCollateral(assetAToken0.address)
      await main.connect(owner).approveCollateral(assetAToken1.address)

      // Switch vault
      await main.connect(owner).switchVault(newVault.address)

      // Check state
      expect(await main.mood()).to.equal(Mood.CALM)
      expect(await main.vault()).to.equal(newVault.address)
      expect(await main.fullyCapitalized()).to.equal(false)

      // Call will not trigger hard default nor soft default in normal situation
      await expect(main.poke()).to.emit(main, 'MoodChanged').withArgs(Mood.CALM, Mood.TRADING)

      // Check state
      expect(await main.mood()).to.equal(Mood.TRADING)
      expect(await main.vault()).to.equal(newVault.address)
      expect(await main.fullyCapitalized()).to.equal(false)

      // Set default rate
      await aToken0.setExchangeRate(fp('0.98'))

      // Call to detect vault switch and state change
      await main.poke()

      // check state - backup vault was selected
      expect(await main.mood()).to.equal(Mood.TRADING)
      expect(await main.vault()).to.equal(backupVault.address)
      expect(await main.fullyCapitalized()).to.equal(false)
    })
    // TODO: Handle no backup vault found
  })

  //  Old Asset Manager

  describe('Base Factor', () => {
    it('Should start with Base Factor = 1', async () => {
      expect(await main.toBUs(bn('1e18'))).to.equal(bn('1e18'))
      expect(await main.fromBUs(bn('1e18'))).to.equal(bn('1e18'))
    })

    context('With issued RTokens', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')
        // Provide approvals
        await token0.connect(addr1).approve(main.address, initialBal)
        await token1.connect(addr1).approve(main.address, initialBal)
        await token2.connect(addr1).approve(main.address, initialBal)
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Process the issuance
        await main.poke()
      })

      it('Should update Base Factor based on Melting Factor', async () => {
        expect(await main.toBUs(bn('1e18'))).to.equal(bn('1e18'))
        expect(await main.fromBUs(bn('1e18'))).to.equal(bn('1e18'))

        // Melt some Rtokens
        let hndAmt: BigNumber = bn('1e18')
        await rToken.connect(addr1).transfer(furnace.address, hndAmt)
        await furnace.connect(addr1).notifyOfDeposit(rToken.address)

        // Call poke to burn tokens
        await advanceTime(config.rewardPeriod.toString())
        await main.poke()

        expect(await main.toBUs(bn('1e18'))).to.equal(bn('100e18').div(99))
        expect(await main.fromBUs(bn('1e18'))).to.equal(bn('0.99e18'))

        // Melt some more Rtokens
        hndAmt = bn('49e18')
        await rToken.connect(addr1).transfer(furnace.address, hndAmt)
        await furnace.connect(addr1).notifyOfDeposit(rToken.address)

        // Call poke to burn tokens
        await advanceTime(config.rewardPeriod.toString())
        await main.poke()

        expect(await main.toBUs(bn('1e18'))).to.equal(bn('100e18').div(50))
        expect(await main.fromBUs(bn('1e18'))).to.equal(bn('0.5e18'))
      })
    })

    context('With ATokens and CTokens', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Setup new vault with ATokens and CTokens
        let newVault: VaultP0 = <VaultP0>(
          await VaultFactory.deploy(
            [collateral2.address, collateral3.address],
            [bn('0.5e18'), bn('0.5e8')],
            []
          )
        )
        // Setup Main
        await newVault.connect(owner).setMain(main.address)

        // Switch Vault
        await main.connect(owner).switchVault(newVault.address)

        // Provide approvals
        await token2.connect(addr1).approve(main.address, initialBal)
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Process the issuance
        await main.poke()
      })

      it('Should update Base Factor based on Basket Dilution Factor', async () => {
        expect(await main.toBUs(bn('1e18'))).to.equal(bn('1e18'))
        expect(await main.fromBUs(bn('1e18'))).to.equal(bn('1e18'))

        // Increase rate for ATokens CToken to double - 100% increase so a 60% applies to base factor (based on f)
        await token2.setExchangeRate(fp(2))
        await token3.setExchangeRate(fp(2))

        // f = fp(0.6) = 40% increase in price of RToken -> (1 + 0.4) / 2 = 7/10
        let b = fp(1)
          .add(bn(2 - 1).mul(fp(1).sub(dist.rsrDist)))
          .div(bn(2))
        expect(await main.toBUs(bn('1e18'))).to.equal(b)
        expect(await main.fromBUs(bn('1e18'))).to.equal(fp('1e18').div(b))

        // Double again (300% increase)
        await token2.setExchangeRate(fp(4))
        await token3.setExchangeRate(fp(4))

        // f = fp(0.6) - 60% of 300% increase = 180% increase in price of RToken -> (1 + 1.8) / 4 = 7/10
        b = fp(1)
          .add(bn(4 - 1).mul(fp(1).sub(dist.rsrDist)))
          .div(bn(4))
        expect(await main.toBUs(bn('1e18'))).to.equal(b)
        expect(await main.fromBUs(bn('1e18'))).to.equal(fp('1e18').div(b))
      })
    })
  })

  describe('Revenues', () => {
    it('Should handle minting of new RTokens for rounding (in Melting)', async () => {
      // Issue some RTokens to user
      const issueAmount: BigNumber = bn('100e18')
      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Call to process revenue
      await main.poke()

      // Melt some Rtokens to increase base factor -  No rounding required
      const hndAmt: BigNumber = bn('20e18')
      await rToken.connect(addr1).approve(furnace.address, hndAmt)
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      // Advance time to get next reward
      await advanceTime(config.rewardPeriod.add(100).toString())

      // Call collect revenue
      await main.poke()

      // No RTokens Minted
      expect(await rToken.totalSupply()).to.equal(issueAmount.sub(hndAmt))
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(hndAmt))
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Burn some more RTokens
      const hndAmt2: BigNumber = bn('10e18')
      await rToken.connect(addr1).transfer(furnace.address, hndAmt2)
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      // Advance time to get next reward
      await advanceTime(config.rewardPeriod.add(100).toString())

      // Call collect revenue
      await main.poke()

      // Some RTokens were minted to handle rounding
      const bUnits: BigNumber = await vault.basketUnits(main.address)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(main.address)).to.equal(
        await main.fromBUs(bUnits)
        // fp(bUnits)
        //   .div(await main.baseFactor())
        //   .sub(await rToken.balanceOf(addr1.address))
      )
    })

    // With ATokens and CTokens
    context('With ATokens and CTokens', async function () {
      let newVault: VaultP0
      let issueAmount: BigNumber
      let rewardAmountCOMP: BigNumber
      let rewardAmountAAVE: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Set vault with ATokens and CTokens
        newVault = <VaultP0>(
          await VaultFactory.deploy(
            [collateral2.address, collateral3.address],
            [bn('0.5e18'), bn('0.5e8')],
            []
          )
        )
        // Setup Main
        await newVault.connect(owner).setMain(main.address)

        // Switch Vault
        await main.connect(owner).switchVault(newVault.address)

        // Provide approvals
        await token2.connect(addr1).approve(main.address, initialBal)
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Process issuance
        await main.poke()

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should claim COMP and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // Check initial state
        expect(await main.mood()).to.equal(Mood.CALM)

        // COMP Rewards
        await compoundMock.setRewards(newVault.address, rewardAmountCOMP)

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>(
          await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
        )

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountCOMP.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(rsrStakingTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenMeltingTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // COMP -> RToken Auction
        expectAuctionInfo(rTokenMeltingTrader, 0, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Advance time till auctioo ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expect(main.poke())
          .to.emit(rsrStakingTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenMeltingTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.not.emit(rsrStakingTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenMeltingTrader, 'AuctionStarted')

        // Check previous auctions closed
        // COMP -> RSR Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          status: AuctionStatus.DONE,
        })

        // COMP -> RToken Auction
        expectAuctionInfo(rTokenMeltingTrader, 0, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          status: AuctionStatus.DONE,
        })

        // Mood back to CALM
        expect(await main.mood()).to.equal(Mood.CALM)
      })

      it('Should claimm AAVE and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        rewardAmountAAVE = bn('0.5e18')

        // Check initial state
        expect(await main.mood()).to.equal(Mood.CALM)

        // AAVE Rewards
        await token2.setRewards(newVault.address, rewardAmountAAVE)

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>(
          await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
        )

        // Collect revenue - Called via poke
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountAAVE.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(rsrStakingTrader, 'AuctionStarted')
          .withArgs(0, aaveAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenMeltingTrader, 'AuctionStarted')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)

        // Check auctions registered
        // AAVE -> RSR Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: aaveAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
        })

        // AAVE -> RToken Auction
        expectAuctionInfo(rTokenMeltingTrader, 0, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),

          status: AuctionStatus.OPEN,
        })

        // Advance time till auctioo ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expect(main.poke())
          .to.emit(rsrStakingTrader, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenMeltingTrader, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.not.emit(rsrStakingTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenMeltingTrader, 'AuctionStarted')

        expectAuctionStatus(rsrStakingTrader, 0, AuctionStatus.DONE)
        expectAuctionStatus(rTokenMeltingTrader, 0, AuctionStatus.DONE)

        // Mood back to CALM
        expect(await main.mood()).to.equal(Mood.CALM)
      })

      it('Should handle large auctions for using maxAuctionSize with f=1 (RSR only)', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 1
        await main
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('2e18')

        // Check initial state
        expect(await main.mood()).to.equal(Mood.CALM)

        // COMP Rewards
        await compoundMock.setRewards(newVault.address, rewardAmountCOMP)

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR = 1 to 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(main, 'RewardsClaimed')
          .withArgs(rewardAmountCOMP, 0)
          .and.to.emit(main, 'AuctionStarted')

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auction registered
        // COMP -> RSR Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Another call should not create any new auctions if still ongoing
        await expect(main.poke()).to.not.emit(main, 'AuctionStarted')
        expect(await main.mood()).to.equal(Mood.TRADING)

        // Check existing auctions still open
        expectAuctionStatus(rsrStakingTrader, 0, AuctionStatus.OPEN)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())
        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // // Close auctions
        await expect(main.poke())
          .to.emit(main, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(main, 'AuctionStarted')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)

        // Check previous auctions closed
        // COMP -> RSR Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          externalAuctionId: bn('0'),
          status: AuctionStatus.DONE,
        })

        // Mood remains in TRADING
        expect(await main.mood()).to.equal(Mood.TRADING)

        // COMP -> RSR Auction
        expectAuctionInfo(rTokenMeltingTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })
        // Mood remains in TRADING
        expect(await main.mood()).to.equal(Mood.TRADING)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Close auction
        await expect(main.poke())
          .to.emit(main, 'AuctionEnded')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.not.emit(main, 'AuctionStarted')

        // Check existing auctions are closed
        expectAuctionStatus(rsrStakingTrader, 0, AuctionStatus.DONE)
        expectAuctionStatus(rTokenMeltingTrader, 0, AuctionStatus.DONE)

        // Mood moved to CALM
        expect(await main.mood()).to.equal(Mood.CALM)
      })

      it('Should handle large auctions for using maxAuctionSize with f=0 (RToken only)', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 0
        await main.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1.5e18')

        // Check initial state
        expect(await main.mood()).to.equal(Mood.CALM)

        // AAVE Rewards
        await token2.setRewards(newVault.address, rewardAmountAAVE)

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>(
          await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
        )

        // Collect revenue - Called via poke
        // Expected values based on Prices between AAVE and RToken = 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(main, 'RewardsClaimed')
          .withArgs(0, rewardAmountAAVE)
          .and.to.emit(main, 'AuctionStarted')

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auction registered
        // AAVE -> RToken Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Another call should not create any new auctions if still ongoing
        await expect(main.poke()).to.not.emit(main, 'AuctionStarted')
        expect(await main.mood()).to.equal(Mood.TRADING)

        // Check existing auctions still open
        expectAuctionStatus(rsrStakingTrader, 0, AuctionStatus.OPEN)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rToken.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Calculate pending amount
        let sellAmtRemainder: BigNumber = rewardAmountAAVE.sub(sellAmt)
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        // Close auctions
        await expect(main.poke())
          .to.emit(rsrStakingTrader, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmt, minBuyAmt)
          .to.emit(rTokenMeltingTrader, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmtRemainder, minBuyAmtRemainder)

        // Check previous auctions closed
        // AAVE -> RToken Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          status: AuctionStatus.DONE,
        })
        // Mood remains in TRADING
        expect(await main.mood()).to.equal(Mood.TRADING)

        // AAVE -> RToken Auction
        expectAuctionInfo(rTokenMeltingTrader, 0, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          status: AuctionStatus.OPEN,
        })
        // Mood remains in TRADING
        expect(await main.mood()).to.equal(Mood.TRADING)

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rToken.connect(addr1).approve(market.address, sellAmtRemainder)
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: sellAmtRemainder,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Close auction
        await expect(main.poke())
          .to.emit(main, 'AuctionEnded')
          .withArgs(1, aaveAsset.address, rTokenAsset.address, sellAmtRemainder, sellAmtRemainder)
          .and.to.not.emit(main, 'AuctionStarted')

        //  Check existing auctions are closed
        expectAuctionStatus(rsrStakingTrader, 0, AuctionStatus.DONE)
        expectAuctionStatus(rTokenMeltingTrader, 0, AuctionStatus.DONE)

        // Mood moved to CALM
        expect(await main.mood()).to.equal(Mood.CALM)
      })

      it('Should handle large auctions using maxAuctionSize with revenue split RSR/RToken', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 1
        await main
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

        // Set COMP tokens as reward
        // Based on current f -> 3.2e18 to RSR and 0.8e18 to Rtoken
        rewardAmountCOMP = bn('4e18')

        // Check initial state
        expect(await main.mood()).to.equal(Mood.CALM)

        // COMP Rewards
        await compoundMock.setRewards(newVault.address, rewardAmountCOMP)

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>(
          await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
        )

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).mul(2).div(100) // due to 2% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = sellAmt.div(4) // keep ratio of 1-f in each auction (Rtoken should be 25% of RSR in this example)
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(main, 'RewardsClaimed')
          .withArgs(rewardAmountCOMP, 0)
          .and.to.emit(rsrStakingTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenMeltingTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auctions registered
        // COMP -> RSR Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // COMP -> RToken Auction
        expectAuctionInfo(rTokenMeltingTrader, 0, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Another call should not create any new auctions if still ongoing
        await expect(main.poke()).to.not.emit(main, 'AuctionStarted')
        expect(await main.mood()).to.equal(Mood.TRADING)

        // Check existing auctions still open
        expectAuctionStatus(rsrStakingTrader, 0, AuctionStatus.OPEN)
        expectAuctionStatus(rTokenMeltingTrader, 0, AuctionStatus.OPEN)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions

        // Calculate pending amount
        let sellAmtRemainder: BigNumber = rewardAmountCOMP
          .sub(sellAmt)
          .sub(sellAmtRToken)
          .mul(80)
          .div(100) // f=0.8 of remaining funds
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        let sellAmtRTokenRemainder: BigNumber = sellAmtRemainder.div(4) // keep ratio of 1-f in each auction (Rtoken should be 25% of RSR in this example)
        let minBuyAmtRTokenRemainder: BigNumber = sellAmtRTokenRemainder.sub(
          sellAmtRTokenRemainder.div(100)
        ) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(rsrStakingTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenMeltingTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.emit(rsrStakingTrader, 'AuctionStarted')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.emit(rTokenMeltingTrader, 'AuctionStarted')
          .withArgs(
            1,
            compAsset.address,
            rTokenAsset.address,
            sellAmtRTokenRemainder,
            minBuyAmtRTokenRemainder
          )

        // Check previous auctions closed
        // COMP -> RSR Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          status: AuctionStatus.DONE,
        })

        // COMP -> RToken Auction
        expectAuctionInfo(rTokenMeltingTrader, 0, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          status: AuctionStatus.DONE,
        })

        // Mood remains in TRADING
        expect(await main.mood()).to.equal(Mood.TRADING)

        expectAuctionInfo(rsrStakingTrader, 1, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        expectAuctionInfo(rTokenMeltingTrader, 1, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRTokenRemainder,
          minBuyAmount: minBuyAmtRTokenRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Check auctions open/closed
        expectAuctionStatus(rsrStakingTrader, 0, AuctionStatus.DONE)
        expectAuctionStatus(rTokenMeltingTrader, 0, AuctionStatus.DONE)
        expectAuctionStatus(rsrStakingTrader, 1, AuctionStatus.OPEN)
        expectAuctionStatus(rTokenMeltingTrader, 1, AuctionStatus.OPEN)

        // Mood remains in TRADING
        expect(await main.mood()).to.equal(Mood.TRADING)

        // Run final auction until all funds are converted
        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmtRemainder)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRTokenRemainder)
        await market.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })
        await market.placeBid(3, {
          bidder: addr1.address,
          sellAmount: sellAmtRTokenRemainder,
          buyAmount: minBuyAmtRTokenRemainder,
        })

        await expect(main.poke())
          .to.emit(main, 'AuctionEnded')
          .withArgs(2, compAsset.address, rsrAsset.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.emit(main, 'AuctionEnded')
          .withArgs(
            3,
            compAsset.address,
            rTokenAsset.address,
            sellAmtRTokenRemainder,
            minBuyAmtRTokenRemainder
          )
          .and.to.not.emit(main, 'AuctionStarted')

        // Check all auctions are closed
        expectAuctionStatus(rsrStakingTrader, 0, AuctionStatus.DONE)
        expectAuctionStatus(rTokenMeltingTrader, 0, AuctionStatus.DONE)
        expectAuctionStatus(rsrStakingTrader, 1, AuctionStatus.DONE)
        expectAuctionStatus(rTokenMeltingTrader, 1, AuctionStatus.DONE)

        // Mood is now CALM
        expect(await main.mood()).to.equal(Mood.CALM)
      })

      it('Should mint RTokens when collateral appreciates and handle revenue auction correctly', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>(
          await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
        )

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('2'))

        // f = fp(0.6) = 40% increase in price of RToken -> (1 + 0.4) / 2 = 7/10
        let b = fp(1)
          .add(bn(2 - 1).mul(dist.rTokenDist))
          .div(bn(2))

        // Check base factor
        expect(await main.toBUs(bn('1e18'))).to.equal(b)

        // Check initial state
        expect(await main.mood()).to.equal(Mood.CALM)

        // Total value being auctioned = sellAmount * new price (1.4) - This is the exact amount of RSR required (because RSR = 1 USD )
        // Note: for rounding division by 10 is done later in calculation
        let currentTotalSupply: BigNumber = await rToken.totalSupply()
        let newTotalSupply: BigNumber = fp(currentTotalSupply).div(b)
        let sellAmt: BigNumber = newTotalSupply.div(100) // due to max auction size of 1%
        let tempValueSell = sellAmt.mul(14)
        let minBuyAmtRSR: BigNumber = tempValueSell.sub(
          tempValueSell.mul(config.maxTradeSlippage).div(BN_SCALE_FACTOR)
        ) // due to trade slippage 1%
        minBuyAmtRSR = minBuyAmtRSR.div(10)

        // Call Poke to collect revenue and mint new tokens
        await expect(main.poke())
          .to.emit(main, 'AuctionStarted')
          .withArgs(0, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // RToken -> RSR Auction
        expectAuctionInfo(rsrStakingTrader, 0, {
          sell: rTokenAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmtRSR,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Check new state
        expect(await main.mood()).to.equal(Mood.TRADING)

        // Perform Mock Bids for RSR(addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmtRSR)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmtRSR,
        })

        // Advance time till auctioo ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Call poke to end current auction, should start a new one with same amount
        await expect(main.poke())
          .to.emit(main, 'AuctionEnded')
          //.withArgs(0, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR)
          .and.to.emit(main, 'AuctionStarted')
          .withArgs(1, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR)

        // Check new auction
        expectAuctionInfo(rTokenMeltingTrader, 0, {
          sell: rTokenAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmtRSR,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })
      })
    })
  })
})
