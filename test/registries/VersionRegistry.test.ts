import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { VersionRegistry } from '@typechain/VersionRegistry'
import { DeployerMock } from '@typechain/DeployerMock'
import { expect } from 'chai'
import { ONE_ADDRESS, ZERO_ADDRESS, ZERO_BYTES } from '#/common/constants'
import { IImplementations } from '#/common/configuration'

async function createVersionRegistry() {
  const [owner] = await ethers.getSigners()

  const versionRegistryFactory = await ethers.getContractFactory('VersionRegistry')
  const versionRegistry = await versionRegistryFactory.deploy(await owner.getAddress())

  return {
    versionRegistry,
    owner,
  }
}

describe('Version Registry', () => {
  let versionRegistry: VersionRegistry
  let deployerMock: DeployerMock
  let owner: SignerWithAddress
  let other: SignerWithAddress

  before(async () => {
    ;({ versionRegistry, owner } = await loadFixture(createVersionRegistry))
  })

  describe('Deployment', () => {
    it('should set the owner to the specified address', async () => {
      expect(await versionRegistry.owner()).to.eq(await owner.getAddress())
    })
  })

  describe('Version Management', () => {
    before(async () => {
      ;[, other] = await ethers.getSigners()
      const DeployerMockFactory = await ethers.getContractFactory('DeployerMock')
      deployerMock = await DeployerMockFactory.deploy()

      await versionRegistry.connect(owner).registerVersion(deployerMock.address)
    })

    it('Registered version correctly', async () => {
      const versionData = await versionRegistry.getLatestVersion()

      expect(versionData.versionHash).not.be.eq(ZERO_BYTES)
      expect(versionData.deprecated).be.eq(false)

      const expectedVersionHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('4.0.0'))
      expect(versionData.versionHash).to.eq(expectedVersionHash)
      expect(await versionRegistry.deployments(expectedVersionHash)).to.not.equal(ZERO_ADDRESS)
      expect(await versionRegistry.deployments(expectedVersionHash)).to.equal(deployerMock.address)
    })

    it('Handles multiple versions', async () => {
      const initialVersionData = await versionRegistry.getLatestVersion()

      // Register new version
      const DeployerMockV2Factory = await ethers.getContractFactory('DeployerMockV2')
      const deployerMockV2 = await DeployerMockV2Factory.deploy()
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
        deployerMock.address
      )
    })

    it('Denies Duplicate and Invalid Registration', async () => {
      // If not owner, should be rejected
      await expect(
        versionRegistry.connect(other).registerVersion(deployerMock.address)
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
