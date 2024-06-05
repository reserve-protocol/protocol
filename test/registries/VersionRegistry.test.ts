import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { VersionRegistry } from '@typechain/VersionRegistry'
import { expect } from 'chai'
import { ZERO_BYTES } from '#/common/constants'

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
  let owner: SignerWithAddress

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
      const DeployerMockFactory = await ethers.getContractFactory('DeployerMock')
      const deployerMock = await DeployerMockFactory.deploy()

      await versionRegistry.registerVersion(deployerMock.address)
    })

    it('Register Version', async () => {
      const versionData = await versionRegistry.getLatestVersion()

      expect(versionData.versionHash).not.be.eq(ZERO_BYTES)
      expect(versionData.deprecated).be.eq(false)
    })

    it('Denies Duplicate Registration', async () => {
      // Same version, different deployer, should be rejected.
      const DeployerMockFactory = await ethers.getContractFactory('DeployerMock')
      const deployerMock = await DeployerMockFactory.deploy()

      await expect(
        versionRegistry.registerVersion(deployerMock.address)
      ).to.be.revertedWithCustomError(versionRegistry, 'VersionRegistry__InvalidRegistration')
    })

    it('Deprecate Version', async () => {
      let versionData = await versionRegistry.getLatestVersion()

      await versionRegistry.deprecateVersion(versionData.versionHash)
      versionData = await versionRegistry.getLatestVersion()

      expect(versionData.versionHash).not.be.eq(ZERO_BYTES)
      expect(versionData.deprecated).be.eq(true)
    })
  })
})
