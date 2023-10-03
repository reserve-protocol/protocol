import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import fs from 'fs'
import {
  IAssetCollDeployments,
  getAssetCollDeploymentFilename,
  getDeploymentFile,
  getDeploymentFilename,
} from '#/scripts/deployment/common'
import { ITokens } from '#/common/configuration'
import { MainP1 } from '@typechain/MainP1'
import { Contract } from 'ethers'

task('get-addys', 'Compile the deployed addresses of an RToken deployment')
  .addOptionalParam('rtoken', 'The address of the RToken', undefined, types.string)
  .addOptionalParam('gov', 'The address of the RToken Governance', undefined, types.string)
  .addOptionalParam('ver', 'The target version', undefined, types.string)
  .setAction(async (params, hre) => {
    /*
        Helper functions
    */
    const capitalize = (s: string) => s && s[0].toUpperCase() + s.slice(1)

    const etherscanUrl = 'https://etherscan.io/address/'

    const getVersion = async (c: Contract) => {
      try {
        return await c.version()
      } catch (e) {
        return 'N/A'
      }
    }

    const createRTokenTableRow = async (name: string, address: string) => {
      const url = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}`
      const response = await fetch(url)
      const data = await response.json()
      const implementation = data.result[0].Implementation
      const component = await hre.ethers.getContractAt('ComponentP1', address)
      return `| ${name} | [${address}](${etherscanUrl}${address}) | [${implementation}](${etherscanUrl}${implementation}#code) | ${await getVersion(
        component
      )} |`
    }

    const createAssetTableRow = async (name: string, address: string) => {
      return `| ${name} | [${address}](${etherscanUrl}${address}) |`
    }

    const createTableRows = async (
      components: { name: string; address: string }[],
      isRToken: boolean
    ) => {
      const rows = []
      for (const component of components) {
        isRToken
          ? rows.push(await createRTokenTableRow(component.name, component.address))
          : rows.push(await createAssetTableRow(component.name, component.address))
      }
      return rows.join('\n')
    }

    const createRTokenMarkdown = async (
      name: string,
      address: string,
      rows: string,
      govRows: string | undefined
    ) => {
      return `# [${name}](${etherscanUrl}${address})
## Component Addresses
| Contract | Address | Implementation | Version |
| --- | --- | --- | --- |
${rows}

${
  govRows &&
  `
## Governance Addresses
| Contract | Address | Implementation | Version |
| --- | --- | --- | --- |
${govRows}
`
}
        `
    }

    const createAssetMarkdown = async (name: string, assets: string, collaterals: string) => {
      return `# ${name}
## Assets
| Contract | Address |
| --- | --- |
${assets}

## Collaterals
| Contract | Address |
| --- | --- |
${collaterals}
        `
    }

    const getRTokenFileName = async (rtoken: string) => {
      const chainId = await getChainId(hre)
      const rToken = await hre.ethers.getContractAt('IRToken', rtoken)
      const rTokenSymbol = await rToken.symbol()
      return `${outputDir}${chainId}-${rTokenSymbol}.md`
    }

    const getAssetFileName = async (version: string) => {
      const chainId = await getChainId(hre)
      return `${outputDir}${chainId}-assets-${version}.md`
    }

    const getComponentFileName = async (version: string) => {
      const chainId = await getChainId(hre)
      return `${outputDir}${chainId}-components-${version}.md`
    }

    const getActiveRoleHolders = async (main: MainP1, role: string) => {
      // get active owners
      //
      const grantedFilter = main.filters.RoleGranted(role)
      const revokedFilter = main.filters.RoleRevoked(role)

      // get granted owners
      const ownersGranted = await main.queryFilter(grantedFilter)
      let owners = ownersGranted.map((event) => {
        return event.args![1]
      })
      interface OwnerCount {
        [key: string]: number
      }

      // count granted owners
      let ownerCount: OwnerCount = {}
      owners.forEach((owner: string) => {
        ownerCount[owner] = (ownerCount[owner] || 0) + 1
      })

      // reduce counts by revoked owners
      const ownersRevoked = await main.queryFilter(revokedFilter)
      ownersRevoked.forEach((event) => {
        const owner = event.args![1]
        ownerCount[owner] = (ownerCount[owner] || 0) - 1
      })
      return Object.keys(ownerCount).filter((owner) => ownerCount[owner] > 0)
    }

    /*
        Compile target addresses and create markdown files
    */

    const outputDir = 'docs/deployed-addresses/'

    if (params.rtoken && params.gov) {
      // if rtoken address is provided, print component addresses

      const rToken = await hre.ethers.getContractAt('IRToken', params.rtoken)
      const mainAddress = await rToken.main()
      const main = await hre.ethers.getContractAt('MainP1', mainAddress)
      const backingManagerAddress = await main.backingManager()
      const basketHandlerAddress = await main.basketHandler()
      const brokerAddress = await main.broker()
      const rsrTraderAddress = await main.rsrTrader()
      const rTokenTraderAddress = await main.rTokenTrader()
      const furnaceAddress = await main.furnace()
      const assetRegistryAddress = await main.assetRegistry()
      const distributorAddress = await main.distributor()
      const stRSRAddress = await main.stRSR()

      const components = [
        { name: 'RToken', address: params.rtoken },
        { name: 'Main', address: mainAddress },
        { name: 'AssetRegistry', address: assetRegistryAddress },
        { name: 'BackingManager', address: backingManagerAddress },
        { name: 'BasketHandler', address: basketHandlerAddress },
        { name: 'Broker', address: brokerAddress },
        { name: 'RSRTrader', address: rsrTraderAddress },
        { name: 'RTokenTrader', address: rTokenTraderAddress },
        { name: 'Distributor', address: distributorAddress },
        { name: 'Furnace', address: furnaceAddress },
        { name: 'StRSR', address: stRSRAddress },
      ]

      const governance = await hre.ethers.getContractAt('Governance', params.gov)
      const timelock = await governance.timelock()

      // confirm timelock is in fact owner of main
      const isOwner = await main.hasRole(await main.OWNER_ROLE(), timelock)
      if (!isOwner) {
        throw new Error('Wrong governance address (Timelock is not owner of Main)')
      }

      const govComponents = [
        { name: 'Governor Alexios', address: params.gov },
        { name: 'Timelock', address: timelock },
      ]

      const rTokenName = await rToken.name()
      const rTokenSymbol = await rToken.symbol()

      const rows = await createTableRows(components, true)
      const govRows = await createTableRows(govComponents, true)
      const markdown = await createRTokenMarkdown(
        `${rTokenSymbol} (${rTokenName})`,
        params.rtoken,
        rows,
        govRows
      )
      fs.writeFileSync(await getRTokenFileName(params.rtoken), markdown)
    } else if (params.ver) {
      // if version is provided, print implementation addresses
      const version = `${hre.network.name}-${params.ver}`
      const collateralDepl = getDeploymentFile(
        getAssetCollDeploymentFilename(await getChainId(hre), version)
      ) as IAssetCollDeployments

      const collaterals = Object.keys(collateralDepl.collateral).map((coll) => {
        const key = coll as keyof ITokens
        return { name: coll, address: collateralDepl.collateral[key]! }
      })
      const collateralRows = await createTableRows(collaterals, false)

      const assets = Object.keys(collateralDepl.assets).map((ass) => {
        const key = ass as keyof ITokens
        return { name: ass, address: collateralDepl.assets[key]! }
      })
      const assetRows = await createTableRows(assets, false)

      const assetMarkdown = await createAssetMarkdown(
        `Assets (${capitalize(hre.network.name)} ${params.ver})`,
        assetRows,
        collateralRows
      )
      fs.writeFileSync(await getAssetFileName(params.ver), assetMarkdown)

      const componentDepl = getDeploymentFile(getDeploymentFilename(await getChainId(hre), version))
      const recursiveDestructure = (
        obj: string | { [key: string]: string },
        key: string
      ): Array<{ name: string; address: string }> | { name: string; address: string } => {
        if (typeof obj === 'string') {
          return { name: capitalize(key), address: obj }
        } else {
          return Object.keys(obj)
            .map((k) => {
              return recursiveDestructure(obj[k], k)
            })
            .flat()
        }
      }

      let components = recursiveDestructure(componentDepl as {}, '') as Array<{
        name: string
        address: string
      }>
      components = components.sort((a, b) => a.name.localeCompare(b.name))
      const componentMarkdown = await createRTokenMarkdown(
        `Component Implementations (${capitalize(hre.network.name)} ${params.ver})`,
        params.version,
        await createTableRows(components, false),
        undefined
      )
      fs.writeFileSync(await getComponentFileName(params.ver), componentMarkdown)
    } else {
      // if neither rtoken address nor version number is provided, throw error
      throw new Error(
        'must provide either RToken address (--rtoken) and RToken governance (--gov), or Version (--ver)'
      )
    }
  })
