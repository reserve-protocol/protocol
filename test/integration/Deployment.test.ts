import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { Collateral, IMPLEMENTATION } from '../fixtures'
import { defaultFixture } from './fixtures'
import { getChainId } from '../../common/blockchain-utils'
import { IConfig, IRTokenConfig, IRTokenSetup, networkConfig } from '../../common/configuration'
import { ZERO_ADDRESS } from '../../common/constants'
import { expectInIndirectReceipt } from '../../common/events'
import { bn, fp } from '../../common/numbers'
import { FacadeWrite, FiatCollateral, TestIDeployer, TestIMain } from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`Deployment - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Tokens and Assets
  let usdtCollateral: FiatCollateral

  // Contracts to retrieve after deploy
  let main: TestIMain
  let deployer: TestIDeployer
  let facadeWrite: FacadeWrite
  let config: IConfig

  let rTokenConfig: IRTokenConfig
  let rTokenSetup: IRTokenSetup

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  describe('Deployment', () => {
    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])

      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()
      ;({ collateral, deployer, config } = await loadFixture(defaultFixture))

      // Deploy DFacadeWriteLib lib
      const facadeWriteLib = await (await ethers.getContractFactory('FacadeWriteLib')).deploy()
      const facadeWriteLibAddr = facadeWriteLib.address

      // Deploy Facade
      const FacadeFactory: ContractFactory = await ethers.getContractFactory('FacadeWrite', {
        libraries: {
          FacadeWriteLib: facadeWriteLibAddr,
        },
      })
      facadeWrite = <FacadeWrite>await FacadeFactory.deploy(deployer.address)

      // Get tokens
      usdtCollateral = <FiatCollateral>collateral[2] // USDT
    })

    it('Should allow to deploy USDT in both prime and backup basket', async () => {
      // Set parameters
      rTokenConfig = {
        name: 'RTKN RToken',
        symbol: 'RTKN',
        mandate: 'mandate',
        params: config,
      }

      rTokenSetup = {
        assets: [],
        primaryBasket: [usdtCollateral.address],
        weights: [fp('1')],
        backups: [
          {
            backupUnit: ethers.utils.formatBytes32String('USD'),
            diversityFactor: bn(1),
            backupCollateral: [usdtCollateral.address],
          },
        ],
      }
      // Deploy RToken via FacadeWrite
      const receipt = await (
        await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
      ).wait()

      const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args
        .main

      main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })
  })
})
