import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ZERO_ADDRESS } from '#/common/constants'
import { Collateral, Implementation, IMPLEMENTATION, defaultFixture } from '../fixtures'
import { AssetPluginRegistry, TestIDeployer, VersionRegistry, DeployerMock } from '../../typechain'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1('Asset Plugin Registry', () => {
  let owner: SignerWithAddress
  let other: SignerWithAddress

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let basket: Collateral[]

  // Deployers
  let deployer: TestIDeployer
  let deployerMockV1: DeployerMock
  let deployerMockV2: DeployerMock

  // Registries
  let versionRegistry: VersionRegistry
  let assetPluginRegistry: AssetPluginRegistry

  beforeEach(async () => {
    ;[owner, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ deployer, basket } = await loadFixture(defaultFixture))

    const versionRegistryFactory = await ethers.getContractFactory('VersionRegistry')
    versionRegistry = await versionRegistryFactory.deploy(await owner.getAddress())

    const assetPluginRegistryFactory = await ethers.getContractFactory('AssetPluginRegistry')
    assetPluginRegistry = await assetPluginRegistryFactory.deploy(versionRegistry.address)

    // Get assets and tokens
    ;[tokenAsset, usdcAsset] = basket

    const DeployerMockFactoryV1 = await ethers.getContractFactory('DeployerMock')
    deployerMockV1 = await DeployerMockFactoryV1.deploy()

    const DeployerMockFactoryV2 = await ethers.getContractFactory('DeployerMockV2')
    deployerMockV2 = (await DeployerMockFactoryV2.deploy()) as DeployerMock
  })

  describe('Deployment', () => {
    it('should set the owner/version registry correctly', async () => {
      expect(await assetPluginRegistry.owner()).to.eq(await owner.getAddress())
      expect(await assetPluginRegistry.versionRegistry()).to.eq(versionRegistry.address)
    })
  })

  describe('Asset Plugin Management', () => {
    it('Register Asset', async () => {
      const versionHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await tokenAsset.version())
      )

      // Register deployment
      await versionRegistry.connect(owner).registerVersion(deployer.address)

      // Register assets
      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(
        false
      )
      await expect(
        assetPluginRegistry.connect(owner).registerAsset(tokenAsset.address, [versionHash])
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, tokenAsset.address, true)
      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(true)

      // Registering again overrides status and enables it again (if it was disabled)
      await expect(
        assetPluginRegistry.connect(owner).registerAsset(tokenAsset.address, [versionHash])
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, tokenAsset.address, true)
      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(true) // remains true

      // Can register multiple versions
      await versionRegistry.connect(owner).registerVersion(deployerMockV1.address)
      await versionRegistry.connect(owner).registerVersion(deployerMockV2.address)
      const versionV1Hash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await deployerMockV1.version())
      )
      const versionV2Hash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await deployerMockV2.version())
      )
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        false
      )
      expect(await assetPluginRegistry.isValidAsset(versionV2Hash, tokenAsset.address)).to.equal(
        false
      )
      await expect(
        assetPluginRegistry
          .connect(owner)
          .registerAsset(tokenAsset.address, [versionV1Hash, versionV2Hash])
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionV1Hash, tokenAsset.address, true)
        .and.to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionV2Hash, tokenAsset.address, true)
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        true
      )
      expect(await assetPluginRegistry.isValidAsset(versionV2Hash, tokenAsset.address)).to.equal(
        true
      )
    })

    it('Denies invalid registrations', async () => {
      const versionHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await tokenAsset.version())
      )
      // Fails if deployment not registered
      await expect(
        assetPluginRegistry.connect(owner).registerAsset(tokenAsset.address, [versionHash])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__InvalidVersion')

      // Register deployment
      await versionRegistry.connect(owner).registerVersion(deployer.address)

      // If not owner cannot register asset
      await expect(
        assetPluginRegistry.connect(other).registerAsset(tokenAsset.address, [versionHash])
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Invalid registration with zero address is also rejected
      await expect(
        assetPluginRegistry.connect(owner).registerAsset(ZERO_ADDRESS, [versionHash])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__InvalidAsset')

      // Fails if any of the versions is not registered
      const versionV1Hash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await deployerMockV1.version())
      )
      await expect(
        assetPluginRegistry
          .connect(owner)
          .registerAsset(tokenAsset.address, [versionHash, versionV1Hash])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__InvalidVersion')

      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(
        false
      )
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        false
      )
    })

    it('Updates versions by asset', async () => {
      const versionHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await tokenAsset.version())
      )
      const versionV1Hash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await deployerMockV1.version())
      )

      // Register deployments
      await versionRegistry.connect(owner).registerVersion(deployer.address)
      await versionRegistry.connect(owner).registerVersion(deployerMockV1.address)

      // Register assets
      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(
        false
      )
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        false
      )

      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateVersionsByAsset(tokenAsset.address, [versionHash, versionV1Hash], [true, true])
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, tokenAsset.address, true)
        .and.to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionV1Hash, tokenAsset.address, true)

      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(true)
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        true
      )

      // Allows to override and unregister
      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateVersionsByAsset(tokenAsset.address, [versionHash, versionV1Hash], [true, false])
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, tokenAsset.address, true)
        .and.to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionV1Hash, tokenAsset.address, false)

      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(true) // remains true
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        false
      ) // unregistered

      // Set another asset
      expect(await assetPluginRegistry.isValidAsset(versionHash, usdcAsset.address)).to.equal(false)
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, usdcAsset.address)).to.equal(
        false
      )

      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateVersionsByAsset(usdcAsset.address, [versionHash, versionV1Hash], [true, true])
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, usdcAsset.address, true)
        .and.to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionV1Hash, usdcAsset.address, true)

      expect(await assetPluginRegistry.isValidAsset(versionHash, usdcAsset.address)).to.equal(true)
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, usdcAsset.address)).to.equal(
        true
      )
    })

    it('Denies invalid updates (version by asset)', async () => {
      const versionHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await tokenAsset.version())
      )

      // Checks valid lengths
      await expect(
        assetPluginRegistry.updateVersionsByAsset(tokenAsset.address, [versionHash], [true, true])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__LengthMismatch')

      // Invalid registration with zero address is also rejected
      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateVersionsByAsset(ZERO_ADDRESS, [versionHash], [true])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__InvalidAsset')

      // Fails if deployment not registered
      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateVersionsByAsset(tokenAsset.address, [versionHash], [true])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__InvalidVersion')

      // Register deployment
      await versionRegistry.connect(owner).registerVersion(deployer.address)

      // If not owner cannot update
      await expect(
        assetPluginRegistry
          .connect(other)
          .updateVersionsByAsset(tokenAsset.address, [versionHash], [true])
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Fails if any of the versions is not registered
      const versionV1Hash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await deployerMockV1.version())
      )
      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateVersionsByAsset(tokenAsset.address, [versionHash, versionV1Hash], [true, true])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__InvalidVersion')

      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(
        false
      )
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        false
      )
    })

    it('Update assets by version', async () => {
      const versionHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await tokenAsset.version())
      )

      // Register deployments
      await versionRegistry.connect(owner).registerVersion(deployer.address)
      await versionRegistry.connect(owner).registerVersion(deployerMockV1.address)

      // Register assets
      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(
        false
      )
      expect(await assetPluginRegistry.isValidAsset(versionHash, usdcAsset.address)).to.equal(false)

      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateAssetsByVersion(versionHash, [tokenAsset.address, usdcAsset.address], [true, true])
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, tokenAsset.address, true)
        .and.to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, usdcAsset.address, true)

      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(true)
      expect(await assetPluginRegistry.isValidAsset(versionHash, usdcAsset.address)).to.equal(true)

      // Allows to override and unregister
      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateAssetsByVersion(
            versionHash,
            [tokenAsset.address, usdcAsset.address],
            [true, false]
          )
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, tokenAsset.address, true)
        .and.to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionHash, usdcAsset.address, false)

      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(true) // remains true
      expect(await assetPluginRegistry.isValidAsset(versionHash, usdcAsset.address)).to.equal(false) // unregistered

      // Set another version
      const versionV1Hash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await deployerMockV1.version())
      )

      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        false
      )
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, usdcAsset.address)).to.equal(
        false
      )

      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateAssetsByVersion(
            versionV1Hash,
            [tokenAsset.address, usdcAsset.address],
            [true, true]
          )
      )
        .to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionV1Hash, tokenAsset.address, true)
        .and.to.emit(assetPluginRegistry, 'AssetPluginRegistryUpdated')
        .withArgs(versionV1Hash, usdcAsset.address, true)

      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, tokenAsset.address)).to.equal(
        true
      )
      expect(await assetPluginRegistry.isValidAsset(versionV1Hash, usdcAsset.address)).to.equal(
        true
      )
    })

    it('Denies invalid updates (asset by version)', async () => {
      const versionHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await tokenAsset.version())
      )

      // Checks valid lengths
      await expect(
        assetPluginRegistry.updateAssetsByVersion(versionHash, [tokenAsset.address], [true, true])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__LengthMismatch')

      // Fails if deployment not registered
      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateAssetsByVersion(versionHash, [tokenAsset.address], [true])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__InvalidVersion')

      // Register deployment
      await versionRegistry.connect(owner).registerVersion(deployer.address)

      // If not owner cannot update
      await expect(
        assetPluginRegistry
          .connect(other)
          .updateAssetsByVersion(versionHash, [tokenAsset.address], [true])
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Fails if any of the assets is zero address
      await expect(
        assetPluginRegistry
          .connect(owner)
          .updateAssetsByVersion(versionHash, [tokenAsset.address, ZERO_ADDRESS], [true, true])
      ).to.be.revertedWithCustomError(assetPluginRegistry, 'AssetPluginRegistry__InvalidAsset')

      expect(await assetPluginRegistry.isValidAsset(versionHash, tokenAsset.address)).to.equal(
        false
      )
    })
  })
})
