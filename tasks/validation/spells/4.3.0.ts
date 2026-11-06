import fs from 'fs'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { BigNumber } from 'ethers'
import { useEnv } from '#/utils/env'
import { advanceTime, getLatestBlockTimestamp } from '#/utils/time'
import { whileImpersonating } from '#/utils/impersonation'
import { BASE_DEPLOYMENTS, MAINNET_DEPLOYMENTS, RTokenDeployment } from '../utils/constants'
import { resetFork } from '#/utils/chain'
import { MAIN_OWNER_ROLE } from '../proposals/4_2_0'
import { proposal_4_3_0 } from '../proposals/4_3_0'
import { Upgrade4_3_0 } from '#/typechain'

const VERSION_4_3_0_HASH = '0xdef94dbdd8411ae515cefcb56b153df454453010a1f4c881b3daa7ed18db793a'
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'

// TODO remove after 4.3.0 is deployed, registered, and its assets are whitelisted
// Deploys + registers 4.3.0, whitelists the RToken's current assets for 4.3.0, and
// settles any open trades, which would otherwise block the spell
const setup_4_3_0 = async (hre: HardhatRuntimeEnvironment, deployment: RTokenDeployment) => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', deployment.rToken)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const versionRegistry = await hre.ethers.getContractAt(
    'VersionRegistry',
    await main.versionRegistry()
  )
  const assetPluginRegistry = await hre.ethers.getContractAt(
    'AssetPluginRegistry',
    await main.assetPluginRegistry()
  )
  const roleRegistry = await hre.ethers.getContractAt(
    'RoleRegistry',
    await versionRegistry.roleRegistry()
  )
  const registryOwner = await roleRegistry.getRoleMember(DEFAULT_ADMIN_ROLE, 0)

  // Deploy + register 4.3.0
  if ((await versionRegistry.deployments(VERSION_4_3_0_HASH)) == hre.ethers.constants.AddressZero) {
    const priorDeployer = await hre.ethers.getContractAt(
      'DeployerP1',
      await versionRegistry.deployments(
        hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(await rToken.version()))
      )
    )
    const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
    const priorGnosisTrade = await hre.ethers.getContractAt(
      'GnosisTrade',
      await broker.batchTradeImplementation()
    )

    const tradingLib = await (
      await hre.ethers.getContractFactory('RecollateralizationLibP1')
    ).deploy()
    const basketLib = await (await hre.ethers.getContractFactory('BasketLibP1')).deploy()
    const deployImpl = async (name: string, libraries = {}, args: unknown[] = []) =>
      (await (await hre.ethers.getContractFactory(name, { libraries })).deploy(...args)).address

    const revenueTrader = await deployImpl('RevenueTraderP1')
    const implementations = {
      main: await deployImpl('MainP1'),
      components: {
        assetRegistry: await deployImpl('AssetRegistryP1'),
        basketHandler: await deployImpl('BasketHandlerP1', { BasketLibP1: basketLib.address }),
        distributor: await deployImpl('DistributorP1'),
        broker: await deployImpl('BrokerP1'),
        backingManager: await deployImpl('BackingManagerP1', {
          RecollateralizationLibP1: tradingLib.address,
        }),
        furnace: await deployImpl('FurnaceP1'),
        rToken: await deployImpl('RTokenP1'),
        rsrTrader: revenueTrader,
        rTokenTrader: revenueTrader,
        stRSR: await deployImpl('StRSRP1Votes'),
      },
      trading: {
        gnosisTrade: await deployImpl('GnosisTrade', {}, [await priorGnosisTrade.gnosis()]),
        dutchTrade: await deployImpl('DutchTrade'),
      },
    }

    const deployer = await (
      await hre.ethers.getContractFactory('DeployerP1')
    ).deploy(await priorDeployer.rsr(), await priorDeployer.rsrAsset(), implementations)
    await deployer.deployed()

    await whileImpersonating(hre, registryOwner, async (signer) => {
      await versionRegistry.connect(signer).registerVersion(deployer.address)
    })
    console.log(`Registered 4.3.0 deployer: ${deployer.address}`)
  }

  // Whitelist the RToken's current assets for 4.3.0
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const [erc20s, assets] = await assetRegistry.getRegistry()
  const toWhitelist: string[] = []
  for (let i = 0; i < assets.length; i++) {
    if (erc20s[i] == rToken.address) continue
    if (await assetPluginRegistry.isDeprecated(assets[i])) continue // unregistered by proposal
    if (!(await assetPluginRegistry.isValidAsset(VERSION_4_3_0_HASH, assets[i]))) {
      toWhitelist.push(assets[i])
    }
  }
  if (toWhitelist.length > 0) {
    await whileImpersonating(hre, registryOwner, async (signer) => {
      await assetPluginRegistry.connect(signer).updateAssetsByVersion(
        VERSION_4_3_0_HASH,
        toWhitelist,
        toWhitelist.map(() => true)
      )
    })
    console.log(`Whitelisted ${toWhitelist.length} assets for 4.3.0`)
  }

  // Settle open trades, which would finish before the proposal executes
  for (const traderAddr of [
    await main.backingManager(),
    await main.rTokenTrader(),
    await main.rsrTrader(),
  ]) {
    const trader = await hre.ethers.getContractAt('ITrading', traderAddr)
    if ((await trader.tradesOpen()) == 0) continue

    for (const erc20 of erc20s) {
      const tradeAddr = await trader.trades(erc20)
      if (tradeAddr == hre.ethers.constants.AddressZero) continue

      const trade = await hre.ethers.getContractAt('ITrade', tradeAddr)
      const toAdvance = (await trade.endTime()) - (await getLatestBlockTimestamp(hre)) + 1
      if (toAdvance > 0) await advanceTime(hre, toAdvance)
      await trader.settleTrade(erc20)
      console.log(`Settled open trade ${tradeAddr}`)
    }
  }
}

// Use this once to serialize a proposal
task('4.3.0', 'Upgrade to 4.3.0').setAction(async (_, hre) => {
  const network = useEnv('FORK_NETWORK').toLowerCase()
  const block = useEnv('FORK_BLOCK')

  const deployments = network === 'base' ? BASE_DEPLOYMENTS : MAINNET_DEPLOYMENTS
  for (const deployment of deployments) {
    // reset fork
    await resetFork(hre, Number(block))

    const rToken = await hre.ethers.getContractAt('RTokenP1', deployment.rToken)
    if ((await rToken.version()) != '4.2.0') {
      console.log(`\nSkipping ${await rToken.symbol()}: not on 4.2.0`)
      continue
    }

    console.log(
      '\n',
      `/*****  4.3.0 Upgrade - RToken: ${await rToken.symbol()} - Address: ${rToken.address} ****/`
    )

    await setup_4_3_0(hre, deployment)

    // TODO remove and replace with canonical spell address after deployment
    let spell: Upgrade4_3_0
    {
      const UpgradeFactory = await hre.ethers.getContractFactory('Upgrade4_3_0')
      spell = await UpgradeFactory.deploy(network !== 'base')
      await spell.deployed()
    }

    const anastasius = await hre.ethers.getContractAt('Governance', deployment.governor)
    const result = await proposal_4_3_0(
      hre,
      deployment.rToken,
      anastasius.address,
      deployment.timelock,
      spell.address
    )
    result.rtoken = deployment.rToken
    result.governor = anastasius.address
    result.timelock = deployment.timelock

    const descHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(result.description))
    result.proposalId = BigNumber.from(
      await anastasius.hashProposal(result.targets, result.values, result.calldatas, descHash)
    ).toString()

    fs.writeFileSync(
      `./tasks/validation/proposals/proposal-${result.proposalId}.json`,
      JSON.stringify(result, null, 4)
    )

    await hre.run('proposal-validator', {
      proposalid: result.proposalId,
    })

    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    if (
      (await main.hasRole(MAIN_OWNER_ROLE, spell.address)) ||
      !(await main.hasRole(MAIN_OWNER_ROLE, deployment.timelock))
    ) {
      throw new Error('RToken rekt')
    }
    if ((await rToken.version()) != '4.3.0') throw new Error('Failed to upgrade to 4.3.0')

    // All registered collateral should be SOUND
    const assetRegistry = await hre.ethers.getContractAt(
      'AssetRegistryP1',
      await main.assetRegistry()
    )
    const [, assets] = await assetRegistry.getRegistry()
    for (const asset of assets) {
      const coll = await hre.ethers.getContractAt('ICollateral', asset)
      if ((await coll.isCollateral()) && (await coll.status()) != 0) {
        throw new Error(`coll ${coll.address} is not SOUND: ${await coll.status()}`)
      }
    }
  }
})
