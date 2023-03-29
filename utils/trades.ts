import { TestITrading, GnosisTrade } from '../typechain'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

export const getTrade = async (
  hre: HardhatRuntimeEnvironment,
  trader: TestITrading,
  sellAddr: string
): Promise<GnosisTrade> => {
  const tradeAddr = await trader.trades(sellAddr)
  return <GnosisTrade>await hre.ethers.getContractAt('GnosisTrade', tradeAddr)
}
