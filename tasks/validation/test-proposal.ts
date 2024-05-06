import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ProposalBuilder, buildProposal } from './utils/governance'
import { Proposal } from '#/utils/subgraph'
import { fp } from '#/common/numbers'

export default async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string
) => {
  console.log('\n* * * * * Run checks for release 3.3.0...')
  const [tester] = await hre.ethers.getSigners()
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)
  const timelockAddress = await governor.timelock()
  const timelock = await hre.ethers.getContractAt('TimelockController', timelockAddress)

  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
  const furnace = await hre.ethers.getContractAt('FurnaceP1', await main.furnace())
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const rsr = await hre.ethers.getContractAt('StRSRP1Votes', await main.rsr())

  console.log('\n3.3.0 check succeeded!')
}

export const saUSDTCollateralAddr = '0x8AD3055286f4E59B399616Bd6BEfE24F64573928'
export const saUSDCCollateralAddr = '0x6E14943224d6E4F7607943512ba17DbBA9524B8e'
export const saEthUSDCCollateralAddr = '0x05beee046A5C28844804E679aD5587046dBffbc0'
export const wcUSDCv3CollateralAddr = '0xf0Fb23485057Fd88C80B9CEc8b433FdA47e0a07A'
export const cUSDTCollateralAddr = '0x1269BFa56EcaE9D6d5003810D4a35bf8479376b8'
export const saEthPyUSDCollateralAddr = '0xe176A5ebFB873D5b3cf1909d0EdaE4FE095F5bc7'
export const TUSDCollateralAddr = '0x7F9999B2C9D310a5f48dfD070eb5129e1e8565E2'
export const cUSDCVaultCollateralAddr = '0x50a9d529ea175cde72525eaa809f5c3c47daa1bb'
export const cUSDTVaultCollateralAddr = '0x5757fF814da66a2B4f9D11d48570d742e246CfD9'
export const daiCollateralAddr = '0xf7d1C6eE4C0D84C6B530D53A897daa1E9eB56833'

export const saEthUSDCERC20Addr = '0x093cB4f405924a0C468b43209d5E466F1dd0aC7d'
export const wcUSDCv3ERC20Addr = '0xfBD1a538f5707C0D67a16ca4e3Fc711B80BD931A'
export const cUSDTVaultERC20Addr = '0x4Be33630F92661afD646081BC29079A38b879aA0'
export const saUSDTERC20Addr = '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'
export const cUSDTERC20Addr = '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9'
export const saEthPyUSDERC20Addr = '0x8d6E0402A3E3aD1b43575b05905F9468447013cF'
export const daiAddr = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

const batchTradeImplAddr = '0x803a52c5DAB69B78419bb160051071eF2F9Fd227'
const dutchTradeImplAddr = '0x4eDEb80Ce684A890Dd58Ae0d9762C38731b11b99'

export const test_proposal: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )

  // Build proposal
  const txs = [
    await basketHandler.populateTransaction.setPrimeBasket(
      [saEthUSDCERC20Addr, wcUSDCv3ERC20Addr, cUSDTERC20Addr, daiAddr],
      [fp('0.25'), fp('0.25'), fp('0.25'), fp('0.25')]
    ),
    await basketHandler.populateTransaction.refreshBasket(),
  ]

  const description = 'Test proposal (swap dai into the basket)'

  return buildProposal(txs, description)
}
