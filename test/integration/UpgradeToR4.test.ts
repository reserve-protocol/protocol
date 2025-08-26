import hre, { ethers } from 'hardhat'
import { VersionRegistry } from '@typechain/VersionRegistry'
import { expect } from 'chai'
import { IImplementations } from '#/common/configuration'
import { DeployerP1 } from '@typechain/DeployerP1'
import { AssetPluginRegistry } from '@typechain/AssetPluginRegistry'
import { whileImpersonating } from '#/utils/impersonation'
import { DAOFeeRegistry } from '@typechain/DAOFeeRegistry'
import { TrustedFillerRegistry } from '@typechain/TrustedFillerRegistry'
import { BrokerP1 } from '@typechain/BrokerP1'
import { resetFork } from '#/utils/chain'
import forkBlockNumber from './fork-block-numbers'

interface RTokenParams {
  name: string
  mainAddress: string
  timelockAddress: string
}

// These RTokens must be on 3.4.0 as the target block
const rTokensToTest: RTokenParams[] = [
  {
    name: 'dgnETH',
    mainAddress: '0xC376168c8470C6e0F4854A7d450874C30A0973d7',
    timelockAddress: '0x98D7C5230C46b671dB0CeBb25B17d1E183B23B97',
  },
]

// 4.2.0
const v4VersionHash = '0x99b189f6a35f2d8d52cd79b21cabb1eca4a12f69132e253d75b4ee7634d0fef8'

async function _confirmVersion(address: string, target: string) {
  const versionedTarget = await ethers.getContractAt('Versioned', address)
  expect(await versionedTarget.version()).to.eq(target)
}

// NOTE: This is an explicit test!
describe('Upgrade from 3.4.0 to 4.2.0 (Mainnet Fork)', () => {
  let implementations: IImplementations
  let deployer: DeployerP1
  let versionRegistry: VersionRegistry
  let assetPluginRegistry: AssetPluginRegistry
  let daoFeeRegistry: DAOFeeRegistry
  let trustedFillerRegistry: TrustedFillerRegistry

  before(async () => {
    const [owner] = await ethers.getSigners()

    await resetFork(hre, forkBlockNumber.default)

    const TradingLibFactory = await ethers.getContractFactory('RecollateralizationLibP1')
    const BasketLibFactory = await ethers.getContractFactory('BasketLibP1')
    const tradingLib = await TradingLibFactory.deploy()
    const basketLib = await BasketLibFactory.deploy()

    const MainFactory = await ethers.getContractFactory('MainP1')
    const RTokenFactory = await ethers.getContractFactory('RTokenP1')
    const FurnaceFactory = await ethers.getContractFactory('FurnaceP1')
    const RevenueTraderFactory = await ethers.getContractFactory('RevenueTraderP1')
    const BackingManagerFactory = await ethers.getContractFactory('BackingManagerP1', {
      libraries: {
        RecollateralizationLibP1: tradingLib.address,
      },
    })
    const AssetRegistryFactory = await ethers.getContractFactory('AssetRegistryP1')
    const BasketHandlerFactory = await ethers.getContractFactory('BasketHandlerP1', {
      libraries: { BasketLibP1: basketLib.address },
    })
    const DistributorFactory = await ethers.getContractFactory('DistributorP1')
    const BrokerFactory = await ethers.getContractFactory('BrokerP1')
    const GnosisTradeFactory = await ethers.getContractFactory('GnosisTrade')
    const DutchTradeFactory = await ethers.getContractFactory('DutchTrade')
    const StRSRFactory = await ethers.getContractFactory('StRSRP1Votes')

    const RevenueTrader = await RevenueTraderFactory.deploy()

    implementations = {
      main: (await MainFactory.deploy()).address,
      components: {
        assetRegistry: (await AssetRegistryFactory.deploy()).address,
        basketHandler: (await BasketHandlerFactory.deploy()).address,
        distributor: (await DistributorFactory.deploy()).address,
        broker: (await BrokerFactory.deploy()).address,
        backingManager: (await BackingManagerFactory.deploy()).address,
        furnace: (await FurnaceFactory.deploy()).address,
        rToken: (await RTokenFactory.deploy()).address,
        rsrTrader: RevenueTrader.address,
        rTokenTrader: RevenueTrader.address,
        stRSR: (await StRSRFactory.deploy()).address,
      },
      trading: {
        gnosisTrade: (await GnosisTradeFactory.deploy('0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101'))
          .address,
        dutchTrade: (await DutchTradeFactory.deploy()).address,
      },
    }

    const DeployerFactory = await ethers.getContractFactory('DeployerP1')
    deployer = await DeployerFactory.deploy(
      '0x320623b8E4fF03373931769A31Fc52A4E78B5d70',
      '0x591529f039Ba48C3bEAc5090e30ceDDcb41D0EaA',
      implementations
    )

    const versionRegistryFactory = await ethers.getContractFactory('VersionRegistry')
    const mockRoleRegistryFactory = await ethers.getContractFactory('MockRoleRegistry')
    const mockRoleRegistry = await mockRoleRegistryFactory.deploy()
    versionRegistry = await versionRegistryFactory.deploy(mockRoleRegistry.address)

    await versionRegistry.registerVersion(deployer.address)

    const AssetPluginRegistryFactory = await ethers.getContractFactory('AssetPluginRegistryMock')
    assetPluginRegistry =
      (await AssetPluginRegistryFactory.deploy()) as unknown as AssetPluginRegistry

    const DAOFeeRegistryFactory = await ethers.getContractFactory('DAOFeeRegistry')
    daoFeeRegistry = await DAOFeeRegistryFactory.deploy(
      mockRoleRegistry.address,
      await owner.getAddress()
    )

    const TrustedFillerRegistryFactory = await ethers.getContractFactory('TrustedFillerRegistry')
    trustedFillerRegistry = <TrustedFillerRegistry>(
      await TrustedFillerRegistryFactory.deploy(mockRoleRegistry.address)
    )
  })

  describe('The Upgrade', () => {
    for (let i = 0; i < rTokensToTest.length; i++) {
      const TIMELOCK_ADDRESS = rTokensToTest[i].timelockAddress
      const MAIN_ADDRESS = rTokensToTest[i].mainAddress

      it(`Double Upgrade Check: ${rTokensToTest[i].name}`, async () => {
        const RTokenMain = await ethers.getContractAt('MainP1', MAIN_ADDRESS)
        const TimelockController = await ethers.getContractAt(
          'TimelockController',
          TIMELOCK_ADDRESS
        )

        await whileImpersonating(hre, TimelockController.address, async (signer) => {
          // Upgrade Main to 4.2.0's Main
          await RTokenMain.connect(signer).upgradeTo(implementations.main)

          // Set registries
          await RTokenMain.connect(signer).setVersionRegistry(versionRegistry.address)
          await RTokenMain.connect(signer).setAssetPluginRegistry(assetPluginRegistry.address)
          await RTokenMain.connect(signer).setDAOFeeRegistry(daoFeeRegistry.address)

          const broker = <BrokerP1>await ethers.getContractAt('BrokerP1', await RTokenMain.broker())
          await broker.connect(signer).setTrustedFillerRegistry(trustedFillerRegistry.address, true)

          // Grant OWNER to Main
          await RTokenMain.connect(signer).grantRole(
            await RTokenMain.OWNER_ROLE(),
            RTokenMain.address
          )

          // Upgrade RToken
          await RTokenMain.connect(signer).upgradeRTokenTo(v4VersionHash, false, false)

          // Revoke OWNER from Main
          await RTokenMain.connect(signer).revokeRole(
            await RTokenMain.OWNER_ROLE(),
            RTokenMain.address
          )
        })

        const targetsToVerify = [
          RTokenMain.address,
          await RTokenMain.rToken(),
          await RTokenMain.assetRegistry(),
          await RTokenMain.basketHandler(),
          await RTokenMain.distributor(),
          await RTokenMain.broker(),
          await RTokenMain.backingManager(),
          await RTokenMain.furnace(),
          await RTokenMain.rsrTrader(),
          await RTokenMain.rTokenTrader(),
          await RTokenMain.stRSR(),
        ]

        for (let j = 0; j < targetsToVerify.length; j++) {
          await _confirmVersion(targetsToVerify[j], '4.2.0')
        }

        const broker = await ethers.getContractAt('BrokerP1', await RTokenMain.broker())
        expect(await broker.batchTradeImplementation()).to.equal(
          implementations.trading.gnosisTrade
        )
        expect(await broker.dutchTradeImplementation()).to.equal(implementations.trading.dutchTrade)

        // So, let's upgrade the RToken _again_ to verify the process flow works.
        await whileImpersonating(hre, TimelockController.address, async (signer) => {
          // Upgrade Main to 4.2.0's Main
          await RTokenMain.connect(signer).upgradeMainTo(v4VersionHash)

          // Upgrade RToken
          await RTokenMain.connect(signer).upgradeRTokenTo(v4VersionHash, true, true)

          // ^^ This is how the upgrade would look like for future versions.
        })
      })
    }
  })
})
