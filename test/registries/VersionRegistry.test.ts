import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ONE_ADDRESS, ZERO_ADDRESS, ZERO_BYTES } from '#/common/constants'
import { IImplementations } from '#/common/configuration'
import { DeployerMock, TestIDeployer, VersionRegistry } from '../../typechain'
import { Implementation, IMPLEMENTATION, defaultFixture } from '../fixtures'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1('Version Registry', () => {
  let versionRegistry: VersionRegistry
  let deployer: TestIDeployer
  let deployerMockV1: DeployerMock
  let deployerMockV2: DeployerMock
  let owner: SignerWithAddress
  let other: SignerWithAddress

  beforeEach(async () => {
    ;[owner, other] = await ethers.getSigners()
    ;({ deployer } = await loadFixture(defaultFixture))

    const versionRegistryFactory = await ethers.getContractFactory('VersionRegistry')
    versionRegistry = await versionRegistryFactory.deploy(await owner.getAddress())

    const DeployerMockFactoryV1 = await ethers.getContractFactory('DeployerMock')
    deployerMockV1 = await DeployerMockFactoryV1.deploy()

    const DeployerMockFactoryV2 = await ethers.getContractFactory('DeployerMockV2')
    deployerMockV2 = await DeployerMockFactoryV2.deploy()
  })

  describe('Deployment', () => {
    it('should set the owner to the specified address', async () => {
      expect(await versionRegistry.owner()).to.eq(await owner.getAddress())
    })
  })

  describe('Version Management', () => {
    beforeEach(async () => {
      await versionRegistry.connect(owner).registerVersion(deployerMockV1.address)
    })

    it('Registered version correctly', async () => {
      const versionData = await versionRegistry.getLatestVersion()

      expect(versionData.versionHash).not.be.eq(ZERO_BYTES)
      expect(versionData.deprecated).be.eq(false)

      const expectedVersionHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('V1'))
      expect(versionData.versionHash).to.eq(expectedVersionHash)
      expect(await versionRegistry.deployments(expectedVersionHash)).to.not.equal(ZERO_ADDRESS)
      expect(await versionRegistry.deployments(expectedVersionHash)).to.equal(
        deployerMockV1.address
      )
    })

    it('Denies Duplicate and Invalid Registration', async () => {
      // If not owner, should be rejected
      await expect(
        versionRegistry.connect(other).registerVersion(deployer.address)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Same version, different deployer, should be rejected.
      const DeployerMockFactory = await ethers.getContractFactory('DeployerMock')
      const deployerMockDup = await DeployerMockFactory.deploy()
      await expect(
        versionRegistry.connect(owner).registerVersion(deployerMockDup.address)
      ).to.be.revertedWithCustomError(versionRegistry, 'VersionRegistry__InvalidRegistration')

      // Invalid registration with zero address is also rejected
      await expect(
        versionRegistry.connect(owner).registerVersion(ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(versionRegistry, 'VersionRegistry__ZeroAddress')
    })

    it('Handles multiple versions', async () => {
      const initialVersionData = await versionRegistry.getLatestVersion()

      // Register new version
      const expectedV2Hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('V2'))
      await expect(versionRegistry.connect(owner).registerVersion(deployerMockV2.address))
        .to.emit(versionRegistry, 'VersionRegistered')
        .withArgs(expectedV2Hash, deployerMockV2.address)

      // Check V2 properly registered
      const v2VersionData = await versionRegistry.getLatestVersion()
      expect(v2VersionData.versionHash).to.eq(expectedV2Hash)
      expect(v2VersionData.versionHash).not.be.eq(ZERO_BYTES)
      expect(v2VersionData.deprecated).be.eq(false)
      expect(await versionRegistry.deployments(expectedV2Hash)).to.not.equal(ZERO_ADDRESS)
      expect(await versionRegistry.deployments(expectedV2Hash)).to.equal(deployerMockV2.address)

      // Original deployment still registered
      expect(await versionRegistry.deployments(initialVersionData.versionHash)).to.equal(
        deployerMockV1.address
      )

      // Can also register the fixture version (4.0.0 or later for example)
      const expectedDeployerFixtureHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(await deployer.version())
      )
      await expect(versionRegistry.connect(owner).registerVersion(deployer.address))
        .to.emit(versionRegistry, 'VersionRegistered')
        .withArgs(expectedDeployerFixtureHash, deployer.address)
    })

    it('Deprecate Version', async () => {
      let versionData = await versionRegistry.getLatestVersion()

      await expect(versionRegistry.connect(owner).deprecateVersion(versionData.versionHash))
        .to.emit(versionRegistry, 'VersionDeprecated')
        .withArgs(versionData.versionHash)
      versionData = await versionRegistry.getLatestVersion()

      expect(versionData.versionHash).not.be.eq(ZERO_BYTES)
      expect(versionData.deprecated).be.eq(true)

      // Cannot deprecate again
      await expect(
        versionRegistry.connect(owner).deprecateVersion(versionData.versionHash)
      ).to.be.revertedWithCustomError(versionRegistry, 'VersionRegistry__AlreadyDeprecated')
    })

    it('Returns implementations correctly', async () => {
      const versionData = await versionRegistry.getLatestVersion()
      const implementations: IImplementations = await versionRegistry.getImplementationForVersion(
        versionData.versionHash
      )
      expect(implementations.main).to.eq(ONE_ADDRESS)
    })
  })
})
