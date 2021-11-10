import { expect } from 'chai'
import { ethers, waffle } from 'hardhat'
import { Wallet, BigNumber, ContractFactory } from 'ethers'
import { bn } from '../../common/numbers'
import { deployerFixture, IManagerConfig } from './utils/fixtures'
import { advanceTime } from '../utils/time'
import { BN_SCALE_FACTOR } from '../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { MainP0 } from '../../typechain/MainP0'
import { VaultP0 } from '../../typechain/VaultP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { AssetP0 } from '../../typechain/AssetP0'
import { AssetManagerP0 } from '../../typechain/AssetManagerP0'
import { DefaultMonitorP0 } from '../../typechain/DefaultMonitorP0'

const createFixtureLoader = waffle.createFixtureLoader

enum State {
  CALM = 0,
  DOUBT = 1,
  TRADING = 2,
  PRECAUTIONARY = 3,
}

describe('MainP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Vault and Assets
  let VaultFactory: ContractFactory
  let vault: VaultP0
  let assets: string[]

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: RSRAssetP0

  // AAVE and Compound
  let compAsset: COMPAssetP0
  let compoundMock: ComptrollerMockP0
  let aaveAsset: AAVEAssetP0
  let aaveMock: AaveLendingPoolMockP0

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: ERC20Mock
  let token2: ERC20Mock
  let token3: ERC20Mock
  let asset0: AssetP0
  let asset1: AssetP0
  let asset2: AssetP0
  let asset3: AssetP0

  // Config values
  let config: IManagerConfig

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let assetManager: AssetManagerP0
  let defaultMonitor: DefaultMonitorP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

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
      compAsset,
      aaveAsset,
      compoundMock,
      aaveMock,
      token0,
      token1,
      token2,
      token3,
      asset0,
      asset1,
      asset2,
      asset3,
      assets,
      vault,
      config,
      deployer,
      main,
      rToken,
      furnace,
      stRSR,
      assetManager,
      defaultMonitor,
    } = await loadFixture(deployerFixture))

    // Mint initial balances
    initialBal = bn('100000e18')
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
      expect(await main.rsr()).to.equal(rsr.address)
      expect(await main.manager()).to.equal(assetManager.address)
      expect(await assetManager.vault()).to.equal(vault.address)
      expect(await main.comptroller()).to.equal(compoundMock.address)
      expect(await main.config()).to.eql(Object.values(config))
      const rTokenAsset = <RTokenAssetP0>await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.state()).to.equal(State.CALM)
      expect(await main.owner()).to.equal(owner.address)
      expect(await main.pauser()).to.equal(owner.address)
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
      await expect(main.connect(other).setPauser(other.address)).to.be.revertedWith('only pauser or owner')

      // Check Pauser not updated
      expect(await main.pauser()).to.equal(addr1.address)
    })
  })

  describe('Configuration/State', () => {
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
        await asset0.erc20(),
        await asset1.erc20(),
        await asset2.erc20(),
        await asset3.erc20(),
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

      await expect(main.connect(addr1).issue(issueAmount)).to.be.revertedWith('ERC20: transfer amount exceeds balance')
      expect(await rToken.totalSupply()).to.equal(bn('0'))
      expect(await vault.basketUnits(main.address)).to.equal(0)
    })

    it('Should issue RTokens with single basket token', async function () {
      const issueAmount: BigNumber = bn('10e18')
      const qty: BigNumber = bn('1e18')
      const newVault: VaultP0 = <VaultP0>await VaultFactory.deploy([assets[0]], [qty], [])

      // Update Vault
      await assetManager.connect(owner).switchVault(newVault.address)

      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)

      // check balances before
      expect(await token0.balanceOf(newVault.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await newVault.basketUnits(main.address)).to.equal(0)

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

      const expectedTkn0: BigNumber = issueAmount.mul(await vault.quantity(asset0.address)).div(BN_SCALE_FACTOR)
      const expectedTkn1: BigNumber = issueAmount.mul(await vault.quantity(asset1.address)).div(BN_SCALE_FACTOR)
      const expectedTkn2: BigNumber = issueAmount.mul(await vault.quantity(asset2.address)).div(BN_SCALE_FACTOR)
      const expectedTkn3: BigNumber = issueAmount.mul(await vault.quantity(asset3.address)).div(BN_SCALE_FACTOR)

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
      expect(await vault.basketUnits(main.address)).to.equal(0)

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

      // Issue rTokens
      await main.connect(addr2).issue(issueAmount)

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Check Balances after
      expect(await token0.balanceOf(vault.address)).to.equal(expectedTkn0.mul(2))
      expect(await token1.balanceOf(vault.address)).to.equal(expectedTkn1.mul(2))
      expect(await token2.balanceOf(vault.address)).to.equal(expectedTkn2.mul(2))
      expect(await token3.balanceOf(vault.address)).to.equal(expectedTkn3.mul(2))

      // Check new issuances was processed
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(addr2.address)).to.equal(0)
      ;[sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(1)
      expect(sm_vault).to.equal(vault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr2.address)
      //expect(sm_at).to.equal()
      expect(sm_proc).to.equal(false)
    })

    it.skip('Should process issuances in multiple attempts (2 blocks)', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      const expectedTkn0: BigNumber = issueAmount.mul(await vault.quantity(asset0.address)).div(BN_SCALE_FACTOR)
      const expectedTkn1: BigNumber = issueAmount.mul(await vault.quantity(asset1.address)).div(BN_SCALE_FACTOR)
      const expectedTkn2: BigNumber = issueAmount.mul(await vault.quantity(asset2.address)).div(BN_SCALE_FACTOR)
      const expectedTkn3: BigNumber = issueAmount.mul(await vault.quantity(asset3.address)).div(BN_SCALE_FACTOR)

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
      // Using minimum issuance of 10,000 per block = 5 blocks
      expect(sm_at).to.equal(currentBlockNumber + 5)
      expect(sm_proc).to.equal(false)

      // Process slow issuances
      await main.poke()

      // Check previous minting was not processed
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(false)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Process slow mintings 4 times
      await main.poke()
      await main.poke()
      await main.poke()
      await main.poke()

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await vault.basketUnits(main.address)).to.equal(0)
      expect(await vault.basketUnits(assetManager.address)).to.equal(issueAmount)
    })
  })

  describe('Redeem', () => {})
  describe('Notice Default', () => {})
})
