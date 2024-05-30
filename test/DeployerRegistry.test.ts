import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ZERO_ADDRESS } from '../common/constants'
import { DeployerRegistry, TestIDeployer } from '../typechain'
import { defaultFixture } from './fixtures'

describe(`DeployerRegistry contract #fast`, () => {
  let owner: SignerWithAddress
  let mockDeployer1: SignerWithAddress
  let mockDeployer2: SignerWithAddress
  let addr1: SignerWithAddress

  // Deployer Registry
  let deployerRegistry: DeployerRegistry

  // Deployer contract
  let deployer: TestIDeployer

  beforeEach(async () => {
    ;[owner, mockDeployer1, mockDeployer2, addr1] = await ethers.getSigners()

    // Deploy fixture
    ;({ deployer } = await loadFixture(defaultFixture))

    // Deploy DeployerRegistry
    const DeployerRegistryFactory = await ethers.getContractFactory('DeployerRegistry')
    deployerRegistry = <DeployerRegistry>await DeployerRegistryFactory.deploy(owner.address)
  })

  describe('Deployment', () => {
    it('Should deploy registry correctly', async () => {
      expect(await deployerRegistry.owner()).to.equal(owner.address)
      expect(await deployerRegistry.ENS()).to.equal('reserveprotocol.eth')
      expect(await deployerRegistry.latestDeployment()).to.equal(ZERO_ADDRESS)
      expect(await deployerRegistry.deployments('1.0.0')).to.equal(ZERO_ADDRESS)
    })
  })

  describe('Ownership', () => {
    it('Should allow owner to transfer ownership', async () => {
      expect(await deployerRegistry.owner()).to.equal(owner.address)

      // Attempt to transfer ownership with another account
      await expect(
        deployerRegistry.connect(addr1).transferOwnership(addr1.address)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Owner remains the same
      expect(await deployerRegistry.owner()).to.equal(owner.address)

      // Transfer ownership with owner
      await expect(deployerRegistry.connect(owner).transferOwnership(addr1.address))
        .to.emit(deployerRegistry, 'OwnershipTransferred')
        .withArgs(owner.address, addr1.address)

      // Owner changed
      expect(await deployerRegistry.owner()).to.equal(addr1.address)
    })
  })

  describe('Register/Unregister', () => {
    it('Should allow owner to register a new version successfully', async () => {
      // Cannot register if not owner
      await expect(
        deployerRegistry.connect(addr1).register('1.0.0', deployer.address, true)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Register version 1.0.0 with owner
      await expect(deployerRegistry.connect(owner).register('1.0.0', deployer.address, true))
        .to.emit(deployerRegistry, 'DeploymentRegistered')
        .withArgs('1.0.0', deployer.address)

      expect(await deployerRegistry.latestDeployment()).to.equal(deployer.address)
      expect(await deployerRegistry.deployments('1.0.0')).to.equal(deployer.address)
    })

    it('Should handle multiple deployers correctly', async () => {
      // Register version 1.0.0
      await expect(deployerRegistry.connect(owner).register('1.0.0', deployer.address, true))
        .to.emit(deployerRegistry, 'DeploymentRegistered')
        .withArgs('1.0.0', deployer.address)

      expect(await deployerRegistry.latestDeployment()).to.equal(deployer.address)
      expect(await deployerRegistry.deployments('1.0.0')).to.equal(deployer.address)

      // Register version 1.2.0 - do not make latest
      await expect(deployerRegistry.connect(owner).register('1.2.0', mockDeployer1.address, false))
        .to.emit(deployerRegistry, 'DeploymentRegistered')
        .withArgs('1.2.0', mockDeployer1.address)

      expect(await deployerRegistry.latestDeployment()).to.equal(deployer.address)
      expect(await deployerRegistry.deployments('1.0.0')).to.equal(deployer.address)
      expect(await deployerRegistry.deployments('1.2.0')).to.equal(mockDeployer1.address)

      // Register version 1.2.1 - nake latest
      await expect(deployerRegistry.connect(owner).register('1.2.1', mockDeployer2.address, true))
        .to.emit(deployerRegistry, 'LatestChanged')
        .withArgs('1.2.1', mockDeployer2.address)

      expect(await deployerRegistry.latestDeployment()).to.equal(mockDeployer2.address)
      expect(await deployerRegistry.deployments('1.0.0')).to.equal(deployer.address)
      expect(await deployerRegistry.deployments('1.2.0')).to.equal(mockDeployer1.address)
      expect(await deployerRegistry.deployments('1.2.1')).to.equal(mockDeployer2.address)
    })

    it('Should perform validations on register', async () => {
      // Deployer address
      await expect(
        deployerRegistry.connect(owner).register('1.0.0', ZERO_ADDRESS, true)
      ).to.be.revertedWith('deployer is zero addr')

      // Cannot overwrite version
      await expect(deployerRegistry.connect(owner).register('1.0.0', deployer.address, true))
        .to.emit(deployerRegistry, 'DeploymentRegistered')
        .withArgs('1.0.0', deployer.address)

      // Attempt to overwrite
      await expect(
        deployerRegistry.connect(owner).register('1.0.0', mockDeployer1.address, true)
      ).to.be.revertedWith('cannot overwrite')
    })

    it('Should allow owner to unregister a version successfully', async () => {
      // Register version 1.0.0
      await expect(deployerRegistry.connect(owner).register('1.0.0', deployer.address, true))
        .to.emit(deployerRegistry, 'DeploymentRegistered')
        .withArgs('1.0.0', deployer.address)

      expect(await deployerRegistry.latestDeployment()).to.equal(deployer.address)
      expect(await deployerRegistry.deployments('1.0.0')).to.equal(deployer.address)

      // Attempt to unregister if not owner
      await expect(deployerRegistry.connect(addr1).unregister('1.0.0')).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Nothing changed
      expect(await deployerRegistry.latestDeployment()).to.equal(deployer.address)
      expect(await deployerRegistry.deployments('1.0.0')).to.equal(deployer.address)

      // Unregister with owner
      await expect(deployerRegistry.connect(owner).unregister('1.0.0'))
        .to.emit(deployerRegistry, 'DeploymentUnregistered')
        .withArgs('1.0.0', deployer.address)

      // Deployment unregistered
      expect(await deployerRegistry.latestDeployment()).to.equal(ZERO_ADDRESS)
      expect(await deployerRegistry.deployments('1.0.0')).to.equal(ZERO_ADDRESS)
    })
  })
})
