import { getChainId } from '../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { bn } from '../../common/numbers'

task(
  'deploy-governor-anastasius',
  'Deploy an instance of governor anastasius from an existing deployment of Governor Alexios'
)
  .addParam('governor', 'The previous governor, must be of type Alexios')
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)

    const oldGovernor = await hre.ethers.getContractAt('Governance', params.governor)
    const timelock = await hre.ethers.getContractAt(
      'TimelockController',
      await oldGovernor.timelock()
    )
    const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await oldGovernor.token())
    if ((await oldGovernor.name()) != 'Governor Alexios') throw new Error('Alexios only')

    let blocktime = 1 // arbitrum
    if (chainId == '1' || chainId == '3' || chainId == '5') blocktime = 12 // mainnet
    if (chainId == '8453' || chainId == '84531') blocktime = 2 // base

    const votingDelay = await oldGovernor.votingDelay()
    const votingPeriod = await oldGovernor.votingPeriod()
    const proposalThresholdVotes = await oldGovernor.proposalThreshold()
    const stRSRSupply = await stRSR.totalSupply()
    const quorumNumerator = await oldGovernor['quorumNumerator()']()
    if (!(await oldGovernor.quorumDenominator()).eq(100)) throw new Error('quorumDenominator wrong')

    const GovernorAnastasiusFactory = await hre.ethers.getContractFactory('Governance')
    const governorAnastasius = await GovernorAnastasiusFactory.deploy(
      stRSR.address,
      timelock.address,
      votingDelay.mul(blocktime),
      votingPeriod.mul(blocktime),
      proposalThresholdVotes.mul(bn('1e8')).div(stRSRSupply),
      quorumNumerator
    )

    console.log('Deployed a new Governor Anastasius to: ', governorAnastasius.address)
  })
