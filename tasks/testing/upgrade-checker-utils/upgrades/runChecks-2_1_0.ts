import { whileImpersonating } from "#/utils/impersonation"
import { HardhatRuntimeEnvironment } from "hardhat/types"

export default async (hre: HardhatRuntimeEnvironment, rTokenAddress: string, governorAddress: string) => {
    const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    const governor = await hre.ethers.getContractAt('Governance', governorAddress)
    const timelock = await hre.ethers.getContractAt('TimelockController', await governor.timelock())
    const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  
    // check Broker updates
    const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
    const preGnosis = await broker.gnosis()
    const preTrade = await broker.tradeImplementation()
  
    const gnosisFactory = await hre.ethers.getContractFactory('EasyAuction')
    const newGnosis = await gnosisFactory.deploy()
    const tradeFactory = await hre.ethers.getContractFactory('GnosisTrade')
    const newTrade = await tradeFactory.deploy()
  
    await whileImpersonating(hre, timelock.address, async (govSigner) => {
      await broker.connect(govSigner).setGnosis(newGnosis.address)
      await broker.connect(govSigner).setTradeImplementation(newTrade.address)
    })
  
    const postGnosis = await broker.gnosis()
    const postTrade = await broker.tradeImplementation()
  
    if (postGnosis != newGnosis.address) {
      throw new Error(`setGnosis() failure: received: ${postGnosis} / expected: ${newGnosis.address}`)
    }
  
    if (postTrade != newTrade.address) {
      throw new Error(`setTradeImplementation() failure: received: ${postTrade} / expected: ${newTrade.address}`)
    }
  
    await whileImpersonating(hre, timelock.address, async (govSigner) => {
      await broker.connect(govSigner).setGnosis(preGnosis)
      await broker.connect(govSigner).setTradeImplementation(preTrade)
    })
  
    // check stRSR updates
    // if these calls succeed, then the functions exist
    await stRSR.getDraftRSR()
    await stRSR.getStakeRSR()
    await stRSR.getTotalDrafts()
  }