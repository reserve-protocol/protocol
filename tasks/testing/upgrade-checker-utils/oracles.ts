import { setCode } from "@nomicfoundation/hardhat-network-helpers"
import { EACAggregatorProxyMock } from "@typechain/EACAggregatorProxyMock"
import { HardhatRuntimeEnvironment } from "hardhat/types"

const overrideOracle = async (
  hre: HardhatRuntimeEnvironment,
  oracleAddress: string
): Promise<EACAggregatorProxyMock> => {
  const oracle = await hre.ethers.getContractAt('EACAggregatorProxy', oracleAddress)
  const aggregator = await oracle.aggregator()
  const accessController = await oracle.accessController()
  const initPrice = await oracle.latestRoundData()
  const mockOracleFactory = await hre.ethers.getContractFactory('EACAggregatorProxyMock')
  const mockOracle = await mockOracleFactory.deploy(aggregator, accessController, initPrice.answer)
  const bytecode = await hre.network.provider.send('eth_getCode', [mockOracle.address])
  await setCode(oracleAddress, bytecode)
  return hre.ethers.getContractAt('EACAggregatorProxyMock', oracleAddress)
}
  
export const pushOraclesForward = async (hre: HardhatRuntimeEnvironment, rTokenAddress: string) => {
  console.log(`\nPushing oracles forward for RToken ${rTokenAddress}...`)
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const registry = await assetRegistry.getRegistry()
  for (const asset of registry.assets) {
    const assetContract = await hre.ethers.getContractAt('TestIAsset', asset)
    let chainlinkFeed = ''
    try {
      chainlinkFeed = await assetContract.chainlinkFeed()
    } catch {
      console.log(`no chainlink oracle found. skipping RTokenAsset ${asset}...`)
      continue
    }
    const realChainlinkFeed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContract.chainlinkFeed()
    )
    const initPrice = await realChainlinkFeed.latestRoundData()
    const oracle = await overrideOracle(hre, realChainlinkFeed.address)
    await oracle.updateAnswer(initPrice.answer)
  }
}