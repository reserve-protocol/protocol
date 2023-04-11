import { whileImpersonating } from "#/utils/impersonation"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { ProposalBuilder, buildProposal } from "../governance"
import { Proposal } from "#/utils/subgraph"

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

export const proposal_2_1_0: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const broker = await hre.ethers.getContractAt(
    'BrokerP1',
    await main.broker()
  )
  const stRSR = await hre.ethers.getContractAt(
    'StRSRP1Votes',
    await main.stRSR()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )

  const txs = [
    await broker.populateTransaction.upgradeTo("0x89209a52d085D975b14555F3e828F43fb7EaF3B7"),
    await stRSR.populateTransaction.upgradeTo("0xfDa8C62d86E426D5fB653B6c44a455Bb657b693f"),
    await basketHandler.populateTransaction.upgradeTo("0x5c13b3b6f40aD4bF7aa4793F844BA24E85482030"),
    await rToken.populateTransaction.upgradeTo("0x5643D5AC6b79ae8467Cf2F416da6D465d8e7D9C1"),
    await broker.populateTransaction.setTradeImplementation("0xAd4B0B11B041BB1342fEA16fc9c12Ef2a6443439")
  ]

  const description = "release 2.1.0 test"

  const proposal = buildProposal(txs, description)

  const governor = await hre.ethers.getContractAt('Governance', governorAddress)

  const call = await governor.populateTransaction.propose(
    proposal.targets,
    proposal.values,
    proposal.calldatas,
    proposal.description
  )

  console.log(`Proposal Transaction:`, call)

  return proposal
}