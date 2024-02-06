import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { FacadeMonitor } from '../../typechain'
import { developmentChains, networkConfig, IMonitorParams } from '../../common/configuration'
import { ZERO_ADDRESS } from '../../common/constants'
import { ContractFactory } from 'ethers'

let facadeMonitor: FacadeMonitor

task(
  'deploy-facade-monitor',
  'Deploys the FacadeMonitor implementation and proxy (if its not an upgrade)'
)
  .addParam('upgrade', 'Set to true if this is for a later upgrade', false, types.boolean)
  .addOptionalParam('owner', 'The address that will own the FacadeMonitor', '', types.string)
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    if (!params.upgrade) {
      if (!params.owner) {
        throw new Error(
          `An --owner must be specified for the initial deployment to ${hre.network.name}`
        )
      }
    }

    if (!params.noOutput) {
      console.log(
        `Deploying FacadeMonitor to ${hre.network.name} (${chainId}) with burner account ${wallet.address}`
      )
    }

    // Setup Monitor Params
    const monitorParams: IMonitorParams = {
      AAVE_V2_DATA_PROVIDER_ADDR: networkConfig[chainId].AAVE_DATA_PROVIDER ?? ZERO_ADDRESS,
    }

    // Deploy FacadeMonitor
    const FacadeMonitorFactory: ContractFactory = await hre.ethers.getContractFactory(
      'FacadeMonitor'
    )
    const facadeMonitorImplAddr = (await hre.upgrades.deployImplementation(FacadeMonitorFactory, {
      kind: 'uups',
      constructorArgs: [monitorParams],
    })) as string

    if (!params.noOutput) {
      console.log(
        `Deployed FacadeMonitor (Implementation) to ${hre.network.name} (${chainId}): ${facadeMonitorImplAddr}`
      )
    }

    if (!params.upgrade) {
      facadeMonitor = <FacadeMonitor>await hre.upgrades.deployProxy(
        FacadeMonitorFactory,
        [params.owner],
        {
          kind: 'uups',
          initializer: 'init',
          constructorArgs: [monitorParams],
        }
      )

      if (!params.noOutput) {
        console.log(
          `Deployed FacadeMonitor (Proxy) to ${hre.network.name} (${chainId}): ${facadeMonitor.address}`
        )
      }
    }
    // Verify if its not a development chain
    if (!developmentChains.includes(hre.network.name)) {
      // Uncomment to verify
      if (!params.noOutput) {
        console.log('sleeping 30s')
      }

      // Sleep to ensure API is in sync with chain
      await new Promise((r) => setTimeout(r, 30000)) // 30s

      if (!params.noOutput) {
        console.log('verifying')
      }

      /** ******************** Verify FacadeMonitor ****************************************/
      console.time('Verifying FacadeMonitor Implementation')
      await hre.run('verify:verify', {
        address: facadeMonitorImplAddr,
        constructorArguments: [monitorParams],
        contract: 'contracts/facade/FacadeMonitor.sol:FacadeMonitor',
      })
      console.timeEnd('Verifying FacadeMonitor Implementation')

      if (!params.noOutput) {
        console.log('verified')
      }
    }

    return { facadeMonitor: facadeMonitor ? facadeMonitor.address : 'N/A', facadeMonitorImplAddr }
  })
