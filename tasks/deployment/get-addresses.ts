import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import fs from 'fs'

task('get-addys', 'Compile the deployed addresses of an RToken deployment')
  .addOptionalParam('rtoken', 'The address of the RToken', undefined, types.string)
  .addOptionalParam('save', 'Save the output to markdown files', false, types.boolean)
  .setAction(async (params, hre) => {

    /*
        Helper functions
    */

    const etherscanUrl = "https://etherscan.io/address/"

    const createTableRow = async (name: string, address: string) => {
        const url = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}`
        const response = await fetch(url)
        const data = await response.json()
        const implementation = data.result[0].Implementation
        const component = await hre.ethers.getContractAt('ComponentP1', address)
        return `| ${name} | [${address}](${etherscanUrl}${address}) | [${implementation}](${etherscanUrl}${implementation}#code) | ${await component.version()} |`
    }

    const createTableRows = async (components: { name: string, address: string }[]) => {
        const rows = []
        for (const component of components) {
            rows.push(await createTableRow(component.name, component.address))
        }
        return rows.join('\n')
    }

    const createMarkdown = async (name: string, address: string, rows: string) => {
        return `# ${name}
## Component Addresses
| Contract | Address | Implementation | Version |
| --- | --- | --- | --- |
${rows}
        `
    }

    const getRTokenFileName = async (rtoken: string) => {
        const chainId = await getChainId(hre)
        const rToken = await hre.ethers.getContractAt('IRToken', rtoken)
        const rTokenName = await rToken.name()
        const rTokenSymbol = await rToken.symbol()
        return `${outputDir}${chainId}-${rTokenName}-${rTokenSymbol}.md`
    }

    const outputDir = 'docs/deployed-addresses/'
    
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
        { name: 'RToken', address: params.rtoken},
        { name: 'Main', address: mainAddress},
        { name: 'AssetRegistry', address: assetRegistryAddress },
        { name: 'BackingManager', address: backingManagerAddress },
        { name: 'BasketHandler', address: basketHandlerAddress },
        { name: 'Broker', address: brokerAddress },
        { name: 'RSRTrader', address: rsrTraderAddress },
        { name: 'RTokenTrader', address: rTokenTraderAddress },
        { name: 'Distributor', address: distributorAddress },
        { name: 'Furnace', address: furnaceAddress },
        { name: 'StRSR', address: stRSRAddress }
    ]
    // TODO: add governance addresses

    const rTokenName = await rToken.name()
    const rTokenSymbol = await rToken.symbol()

    const rows = await createTableRows(components)
    const markdown = await createMarkdown(`${rTokenSymbol} (${rTokenName})`, params.rtoken, rows)
    fs.writeFileSync(await getRTokenFileName(params.rtoken), markdown)
  })
