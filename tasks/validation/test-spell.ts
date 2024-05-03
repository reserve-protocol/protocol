import fs from 'fs'
import { task } from 'hardhat/config'
import { BigNumber } from 'ethers'
import { MAINNET_DEPLOYMENTS } from './utils/constants'
import { proposal_3_4_0_step_1, proposal_3_4_0_step_2 } from './proposals/3_4_0'

// Use this once to serialize a proposal
task(
  'test-spell',
  "Check the implementation to figure out what this does; it's always in flux"
).setAction(async (params, hre) => {
  console.log('Part 1')

  // Deploy 3.4.0 Upgrade spell
  console.log('Deploying 3.4.0 Upgrade spell...')
  const SpellFactory = await hre.ethers.getContractFactory('Upgrade3_4_0')
  const spell = await SpellFactory.deploy()
  console.log('Deployed!')

  for (const deployment of MAINNET_DEPLOYMENTS) {
    const step1 = await proposal_3_4_0_step_1(
      hre,
      deployment.rToken,
      deployment.governor,
      deployment.timelock,
      spell.address
    )
    step1.rtoken = deployment.rToken
    step1.governor = deployment.governor
    step1.timelock = deployment.timelock

    const governor = await hre.ethers.getContractAt('Governance', deployment.governor)
    const descHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(step1.description))
    step1.proposalId = BigNumber.from(
      await governor.hashProposal(step1.targets, step1.values, step1.calldatas, descHash)
    ).toString()

    fs.writeFileSync(
      `./tasks/validation/proposals/proposal-${step1.proposalId}.json`,
      JSON.stringify(step1, null, 4)
    )

    await hre.run('proposal-validator', {
      proposalid: step1.proposalId,
    })

    const rToken = await hre.ethers.getContractAt('RTokenP1', deployment.rToken)
    if ((await rToken.version()) != '3.4.0') throw new Error('Failed to upgrade to 3.4.0')

    console.log('Part 2')

    // const step2 = await proposal_3_4_0_step_2(hre, deployment.rtoken, deployment.governor, deployment.timelock)
    // console.log(step2)
  }
})
