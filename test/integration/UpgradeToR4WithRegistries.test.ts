import hre, { ethers } from 'hardhat'
import { reset } from '@nomicfoundation/hardhat-network-helpers'
import { VersionRegistry } from '@typechain/VersionRegistry'
import { expect } from 'chai'
import { forkRpcs } from '#/utils/fork'
import { IImplementations } from '#/common/configuration'
import { AssetPluginRegistry } from '@typechain/AssetPluginRegistry'
import { whileImpersonating } from '#/utils/impersonation'
import { DAOFeeRegistry } from '@typechain/DAOFeeRegistry'

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

const v4VersionHash = '0x81ed76178093786cbe0cb79744f6e7ca3336fbb9fe7d1ddff1f0157b63e09813'
const v2VersionHash = '0xb4bcb154e38601c389396fa918314da42d4626f13ef6d0ceb07e5f5d26b2fbc3'

async function _confirmVersion(address: string, target: string) {
  const versionedTarget = await ethers.getContractAt('Versioned', address)
  expect(await versionedTarget.version()).to.eq(target)
}

// NOTE: This is an explicit test!
describe('Upgrade from 4.0.0 to New Version with all Registries Enabled', () => {
  let versionRegistry: VersionRegistry
  let assetPluginRegistry: AssetPluginRegistry
  let daoFeeRegistry: DAOFeeRegistry

  let implementationsR4: IImplementations
  let implementationsR2: IImplementations

  before(async () => {
    await reset(forkRpcs.mainnet, 19991614)
    const [owner] = await ethers.getSigners()

    // Setup Registries
    const versionRegistryFactory = await ethers.getContractFactory('VersionRegistry')
    const mockRoleRegistryFactory = await ethers.getContractFactory('MockRoleRegistry')
    const mockRoleRegistry = await mockRoleRegistryFactory.deploy()
    versionRegistry = await versionRegistryFactory.deploy(mockRoleRegistry.address)

    const AssetPluginRegistryFactory = await ethers.getContractFactory('AssetPluginRegistry')
    assetPluginRegistry = await AssetPluginRegistryFactory.deploy(versionRegistry.address)

    const DAOFeeRegistryFactory = await ethers.getContractFactory('DAOFeeRegistry')
    daoFeeRegistry = await DAOFeeRegistryFactory.deploy(
      mockRoleRegistry.address,
      await owner.getAddress()
    )

    // Setup Common Dependencies
    const TradingLibFactory = await ethers.getContractFactory('RecollateralizationLibP1')
    const BasketLibFactory = await ethers.getContractFactory('BasketLibP1')
    const tradingLib = await TradingLibFactory.deploy()
    const basketLib = await BasketLibFactory.deploy()

    // Setup R4 Implementations & Deployer
    {
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

      implementationsR4 = {
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
          gnosisTrade: (await GnosisTradeFactory.deploy()).address,
          dutchTrade: (await DutchTradeFactory.deploy()).address,
        },
      }

      const DeployerFactory = await ethers.getContractFactory('DeployerP1')
      const deployerR4 = await DeployerFactory.deploy(
        '0x320623b8E4fF03373931769A31Fc52A4E78B5d70',
        '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101',
        '0x591529f039Ba48C3bEAc5090e30ceDDcb41D0EaA',
        implementationsR4
      )
      await versionRegistry.registerVersion(deployerR4.address)
    }

    // Setup R2 Implementations & Deployer
    {
      const MainFactory = await ethers.getContractFactory('MainP1V2')
      const RTokenFactory = await ethers.getContractFactory('RTokenP1V2')
      const FurnaceFactory = await ethers.getContractFactory('FurnaceP1V2')
      const RevenueTraderFactory = await ethers.getContractFactory('RevenueTraderP1V2')
      const BackingManagerFactory = await ethers.getContractFactory('BackingManagerP1V2', {
        libraries: {
          RecollateralizationLibP1: tradingLib.address,
        },
      })
      const AssetRegistryFactory = await ethers.getContractFactory('AssetRegistryP1V2')
      const BasketHandlerFactory = await ethers.getContractFactory('BasketHandlerP1V2', {
        libraries: { BasketLibP1: basketLib.address },
      })
      const DistributorFactory = await ethers.getContractFactory('DistributorP1V2')
      const BrokerFactory = await ethers.getContractFactory('BrokerP1V2')
      const GnosisTradeFactory = await ethers.getContractFactory('GnosisTrade')
      const DutchTradeFactory = await ethers.getContractFactory('DutchTrade')
      const StRSRFactory = await ethers.getContractFactory('StRSRP1VotesV2')

      const RevenueTrader = await RevenueTraderFactory.deploy()

      implementationsR2 = {
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
          gnosisTrade: (await GnosisTradeFactory.deploy()).address,
          dutchTrade: (await DutchTradeFactory.deploy()).address,
        },
      }

      const DeployerFactory = await ethers.getContractFactory('DeployerP1V2')
      const deployerR2 = await DeployerFactory.deploy(
        '0x320623b8E4fF03373931769A31Fc52A4E78B5d70',
        '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101',
        '0x591529f039Ba48C3bEAc5090e30ceDDcb41D0EaA',
        implementationsR2
      )
      await versionRegistry.registerVersion(deployerR2.address)
    }
  })

  describe('Upgrade Check', () => {
    for (let i = 0; i < rTokensToTest.length; i++) {
      const TIMELOCK_ADDRESS = rTokensToTest[i].timelockAddress
      const MAIN_ADDRESS = rTokensToTest[i].mainAddress

      it(`Progressive Upgrade Check - ${rTokensToTest[i].name}`, async () => {
        const RTokenMain = await ethers.getContractAt('MainP1', MAIN_ADDRESS)
        const RTokenAssetRegistry = await ethers.getContractAt(
          'AssetRegistryP1',
          await RTokenMain.assetRegistry()
        )
        const TimelockController = await ethers.getContractAt(
          'TimelockController',
          TIMELOCK_ADDRESS
        )

        await whileImpersonating(hre, TimelockController.address, async (signer) => {
          // Upgrade Main to 4.0.0's Main
          await RTokenMain.connect(signer).upgradeTo(implementationsR4.main)

          // Set registries
          await RTokenMain.connect(signer).setVersionRegistry(versionRegistry.address)
          await RTokenMain.connect(signer).setAssetPluginRegistry(assetPluginRegistry.address)
          await RTokenMain.connect(signer).setDAOFeeRegistry(daoFeeRegistry.address)

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
          RTokenAssetRegistry.address,
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
          await _confirmVersion(targetsToVerify[j], '4.0.0')
        }

        const currentAssetRegistry = await RTokenAssetRegistry.getRegistry()
        const currentAssetPlugins = currentAssetRegistry.assets

        // We don't have all the assets in the registry, so this should fail
        await expect(RTokenAssetRegistry.validateCurrentAssets()).to.be.revertedWith(
          'unsupported asset'
        )

        // So, let's upgrade the RToken to a new version now.
        await whileImpersonating(hre, TimelockController.address, async (signer) => {
          // Upgrade Main to 4.0.0's Main
          await RTokenMain.connect(signer).upgradeMainTo(v2VersionHash)

          // Registry does not have assets yet.
          await expect(
            RTokenMain.connect(signer).upgradeRTokenTo(v2VersionHash, true, true)
          ).to.be.revertedWith('unsupported asset')
        })

        // Register Assets in the Registry
        await assetPluginRegistry.updateAssetsByVersion(
          v4VersionHash,
          currentAssetPlugins,
          currentAssetPlugins.map(() => true)
        )
        await assetPluginRegistry.updateAssetsByVersion(
          v2VersionHash,
          currentAssetPlugins,
          currentAssetPlugins.map(() => true)
        )

        // Finish upgrade, with asset validation
        await whileImpersonating(hre, TimelockController.address, async (signer) => {
          // Upgrade Main to 4.0.0's Main
          await RTokenMain.connect(signer).upgradeMainTo(v2VersionHash)

          // Upgrade RToken, without validating assets
          await RTokenMain.connect(signer).upgradeRTokenTo(v2VersionHash, true, true)
        })
      })
    }
  })
})
