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
const tocFilename = 'docs/deployed-addresses/index.json'
import toc from '#/docs/deployed-addresses/index.json'

type Network = 'mainnet' | 'base'

task('get-addys', 'Compile the deployed addresses of an RToken deployment')
  .addOptionalParam('rtoken', 'The address of the RToken', undefined, types.string)
  .addOptionalParam('gov', 'The address of the RToken Governance', undefined, types.string)
  .addOptionalParam('ver', 'The target version', undefined, types.string)
  .setAction(async (params, hre) => {
    /*
    Helper functions
    */

    // hacky api throttler, basescan has rate limits 5req/sec
    const delay = async (ms: number) => {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    const capitalize = (s: string) => s && s[0].toUpperCase() + s.slice(1)

    const chainId = await getChainId(hre)
    const network: Network = hre.network.name as Network
    let scannerUrl: string
    let scannerApiUrl: string
    switch (network) {
      case 'mainnet':
        scannerUrl = 'https://etherscan.io/address/'
        scannerApiUrl = `https://api.etherscan.io/api`
        break
      case 'base':
        scannerUrl = 'https://basescan.org/address/'
        scannerApiUrl = `https://api.basescan.org/api`
        break
      default:
        throw new Error(`Unsupported network: ${network}`)
    }

    const getVersion = async (c: Contract) => {
      try {
        return await c.version()
      } catch (e) {
        return 'N/A'
      }
    }

    const createRTokenTableRow = async (name: string, address: string) => {
      const url = `${scannerApiUrl}?module=contract&action=getsourcecode&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}`
      await delay(200)
      const response = await fetch(url)
      const data = await response.json()
      const implementation = data.result[0].Implementation
      const component = await hre.ethers.getContractAt('ComponentP1', address)
      let row = `| ${name} | [${address}](${scannerUrl}${address}) |`
      if (!!implementation) {
        row += `[${implementation}](${scannerUrl}${implementation}#code) | ${await getVersion(
          component
        )} |`
      }
      return row
    }

    const createComponentTableRow = async (name: string, address: string) => {
      const url = `${scannerApiUrl}?module=contract&action=getsourcecode&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}`
      await delay(200)
      const response = await fetch(url)
      const data = await response.json()
      const implementation = data.result[0].Implementation
      const component = await hre.ethers.getContractAt('ComponentP1', address)
      return `| ${name} | [${address}](${scannerUrl}${address}) | ${await getVersion(component)} |`
    }

    const createAssetTableRow = async (name: string, address: string) => {
      return `| ${name} | [${address}](${scannerUrl}${address}) |`
    }

    const createTableRows = async (
      components: { name: string; address: string }[],
      isRToken: boolean,
      isComponent: boolean = false
    ) => {
      const rows = []
      for (const component of components) {
        if (!component.address) continue
        isRToken
          ? rows.push(await createRTokenTableRow(component.name, component.address))
          : isComponent
          ? rows.push(await createComponentTableRow(component.name, component.address))
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
      return `# [${name}](${scannerUrl}${address})
## Component Addresses
| Contract | Address | Implementation | Version |
| --- | --- | --- | --- |
${rows}

${
  govRows &&
  `
## Governance Addresses
| Contract | Address |
| --- | --- |
${govRows}
`
}
        `
    }

    const createComponentMarkdown = async (name: string, rows: string) => {
      return `# ${name}
## Component Addresses
| Contract | Address | Version |
| --- | --- | --- |
${rows}
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
      const rToken = await hre.ethers.getContractAt('IRToken', rtoken)
      const rTokenSymbol = await rToken.symbol()
      return `${outputDir}${chainId}-${rTokenSymbol}.md`
    }

    const getAssetFileId = (version: string) => {
      return `assets-${version}`
    }

    const getComponentFileId = (version: string) => {
      return `components-${version}`
    }

    const getAssetFileName = (assetFileId: string) => {
      return `${outputDir}${chainId}-${assetFileId}.md`
    }

    const getComponentFileName = (componentFileId: string) => {
      return `${outputDir}${chainId}-${componentFileId}.md`
    }

    /*
        Compile target addresses and create markdown files
    */

    const outputDir = 'docs/deployed-addresses/'

    if (params.rtoken && params.gov) {
      // if rtoken address is provided, print component addresses

      const rToken = await hre.ethers.getContractAt('IRToken', params.rtoken)
      const symbol = await rToken.symbol()
      console.log(`Collecting addresses for RToken: ${symbol} (${params.rtoken}))`)
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
        { name: 'Governor', address: params.gov },
        { name: 'Timelock', address: timelock },
      ]

      const rTokenName = await rToken.name()
      const rTokenSymbol = await rToken.symbol()

      const rows = await createTableRows(components, true)
      const govRows = await createTableRows(govComponents, true)
      const markdown = await createRTokenMarkdown(
        `${rTokenSymbol} (${rTokenName}) - ${capitalize(hre.network.name)}`,
        params.rtoken,
        rows,
        govRows
      )
      const rTokenFileName = await getRTokenFileName(params.rtoken)
      fs.writeFileSync(rTokenFileName, markdown)
      console.log(`Wrote ${rTokenFileName}`)

      toc[network]['rtokens'].indexOf(rTokenSymbol) === -1 &&
        toc[network]['rtokens'].push(rTokenSymbol)
      fs.writeFileSync(tocFilename, JSON.stringify(toc, null, 2))
      console.log(`Updated table of contents`)
    } else if (params.ver) {
      console.log(`Collecting addresses for Version: ${params.ver} (${hre.network.name})`)
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
      const assetFileId = getAssetFileId(params.ver)
      const assetFileName = getAssetFileName(assetFileId)

      fs.writeFileSync(assetFileName, assetMarkdown)
      console.log(`Wrote ${assetFileName}`)

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
      const componentMarkdown = await createComponentMarkdown(
        `Component Implementations (${capitalize(hre.network.name)} ${params.ver})`,
        await createTableRows(components, false, true)
      )

      const componentFileId = getComponentFileId(params.ver)
      const componentFileName = getComponentFileName(componentFileId)
      fs.writeFileSync(componentFileName, componentMarkdown)
      console.log(`Wrote ${componentFileName}`)

      toc[network]['components'].indexOf(componentFileId) === -1 &&
        toc[network]['components'].push(componentFileId)
      toc[network]['assets'].indexOf(assetFileId) === -1 && toc[network]['assets'].push(assetFileId)
      fs.writeFileSync(tocFilename, JSON.stringify(toc, null, 2))
      console.log(`Updated table of contents`)
    } else {
      // if neither rtoken address nor version number is provided, throw error
      throw new Error(
        'must provide either RToken address (--rtoken) and RToken governance (--gov), or Version (--ver)'
      )
    }
  })
