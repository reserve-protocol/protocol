import { getChainId } from '../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { bn } from '../../common/numbers'

task(
  'deploy-governor-anastasius',
  'Deploy an instance of governor anastasius from an existing deployment of Governor Alexios, with new timelock'
)
  .addParam('alexios', 'The previous governor, must be of type Alexios')
  .addParam('guardian', 'The guardian to be set on the timelock')
  .setAction(async (params, hre) => {
    const [signer] = await hre.ethers.getSigners()
    const chainId = await getChainId(hre)

    // Deploy new timelock
    const TimelockFactory = await hre.ethers.getContractFactory('TimelockController')
    const timelock = await TimelockFactory.deploy(
      259200, // 3 days
      [],
      [],
      signer.address // will renounce after saving proposer/canceller/executor
    )
    console.log('Deployed a new TimelockController to: ', timelock.address)

    if (!(await timelock.hasRole(await timelock.TIMELOCK_ADMIN_ROLE(), timelock.address))) {
      throw new Error('Timelock does not admin itself')
    }

    // Deploy Anastasius
    const oldGovernor = await hre.ethers.getContractAt('Governance', params.alexios)
    const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await oldGovernor.token())
    if ((await oldGovernor.name()) != 'Governor Alexios') throw new Error('Alexios only')

    let blocktime = 1 // arbitrum
    if (chainId == '1' || chainId == '3' || chainId == '5') blocktime = 12 // mainnet
    if (chainId == '8453' || chainId == '84531') blocktime = 2 // base

    console.log(`Using blocktime of ${blocktime} seconds`)

    const votingDelay = await oldGovernor.votingDelay()
    const votingPeriod = await oldGovernor.votingPeriod()
    const proposalThresholdVotes = await oldGovernor.proposalThreshold()
    const stRSRSupply = await stRSR.totalSupply()
    const quorumNumerator = await oldGovernor['quorumNumerator()']()
    if (!(await oldGovernor.quorumDenominator()).eq(100)) throw new Error('quorumDenominator wrong')

    const GovernorAnastasiusFactory = await hre.ethers.getContractFactory('Governance')
    const anastasius = await GovernorAnastasiusFactory.deploy(
      stRSR.address,
      timelock.address,
      votingDelay.mul(blocktime),
      votingPeriod.mul(blocktime),
      proposalThresholdVotes.mul(bn('1e8')).div(stRSRSupply),
      quorumNumerator
    )

    console.log('Deployed a new Governor Anastasius to: ', anastasius.address)

    // Link timelock to Anastasius
    await timelock.connect(signer).grantRole(await timelock.PROPOSER_ROLE(), anastasius.address)
    await timelock.connect(signer).grantRole(await timelock.EXECUTOR_ROLE(), anastasius.address)
    await timelock.connect(signer).grantRole(await timelock.CANCELLER_ROLE(), anastasius.address)
    await timelock.connect(signer).grantRole(await timelock.CANCELLER_ROLE(), params.guardian) // guardian
    await timelock
      .connect(signer)
      .renounceRole(await timelock.TIMELOCK_ADMIN_ROLE(), signer.address)

    console.log('Finished setting up timelock')
  })
