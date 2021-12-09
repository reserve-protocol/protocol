import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { ZERO_ADDRESS } from '../../common/constants'
import { bn } from '../../common/numbers'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { MainP0 } from '../../typechain/MainP0'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { VaultP0 } from '../../typechain/VaultP0'
import { Collateral, defaultFixture, IConfig, IRevenueShare } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('DeployerP0 contract', () => {
  let owner: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Vault and Collateral
  let vault: VaultP0
  let collateral: Collateral[]

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: RSRAssetP0

  // AAVE and Compound
  let compAsset: COMPAssetP0
  let compoundMock: ComptrollerMockP0
  let aaveAsset: AAVEAssetP0
  let aaveMock: AaveLendingPoolMockP0

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

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compAsset,
      aaveAsset,
      compoundMock,
      aaveMock,
      collateral,
      vault,
      config,
      dist,
      deployer,
      main,
      rToken,
      furnace,
      stRSR,
    } = await loadFixture(defaultFixture))
  })

  describe('Deployment', () => {
    it('Should deploy contracts', async () => {
      // Contracts deployed
      expect(main.address).not.to.equal(ZERO_ADDRESS)
      expect(rToken.address).not.to.equal(ZERO_ADDRESS)
      expect(furnace.address).not.to.equal(ZERO_ADDRESS)
      expect(stRSR.address).not.to.equal(ZERO_ADDRESS)
    })

    it('Should setup Main correctly', async () => {
      expect(await main.rsr()).to.equal(rsr.address)
      expect((await main.oracle())[0]).to.equal(compoundMock.address)
      const rTokenAsset = <RTokenAssetP0>(
        await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
      )
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
    })

    it('Should setup RToken correctly', async () => {
      expect(await rToken.name()).to.equal('RTKN RToken')
      expect(await rToken.symbol()).to.equal('RTKN')
      expect(await rToken.decimals()).to.equal(18)
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await rToken.main()).to.equal(main.address)
    })

    it('Should setup Furnace correctly', async () => {
      expect(await furnace.rToken()).to.equal(rToken.address)
    })

    it('Should setup stRSR correctly', async () => {
      expect(await stRSR.main()).to.equal(main.address)
      expect(await stRSR.name()).to.equal('stRTKNRSR Token')
      expect(await stRSR.symbol()).to.equal('stRTKNRSR')
      expect(await stRSR.decimals()).to.equal(18)
      expect(await stRSR.totalSupply()).to.equal(0)
    })

    it('Should revert if Vault has unapproved collateral', async () => {
      const approvedCollateral: string[] = [collateral[0].address]

      await expect(
        deployer.deploy(
          'RTKN RToken',
          'RTKN',
          owner.address,
          vault.address,
          config,
          dist,
          compoundMock.address,
          aaveMock.address,
          approvedCollateral
        )
      ).to.be.revertedWith('UnapprovedCollateral()')
    })
  })
})
