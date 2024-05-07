import fs from 'fs'
import { task } from 'hardhat/config'
import { BigNumber } from 'ethers'
import { useEnv } from '#/utils/env'
import { BASE_DEPLOYMENTS, MAINNET_DEPLOYMENTS } from '../utils/constants'
import {
  proposal_3_4_0_step_1,
  proposal_3_4_0_step_2,
  EXECUTOR_ROLE,
  PROPOSER_ROLE,
  CANCELLER_ROLE,
} from '../proposals/3_4_0'

// Use this once to serialize a proposal
task(
  '3.4.0',
  "Check the implementation to figure out what this does; it's always in flux"
).setAction(async (params, hre) => {
  console.log('Part 1')

  const network = useEnv('FORK_NETWORK').toLowerCase()

  // Deploy 3.4.0 Upgrade spell
  console.log('Deploying 3.4.0 Upgrade spell...')
  const SpellFactory = await hre.ethers.getContractFactory('Upgrade3_4_0')
  const spell = await SpellFactory.deploy(network != 'base')
  console.log('Deployed!')

  const deployments = network == 'base' ? BASE_DEPLOYMENTS : MAINNET_DEPLOYMENTS
  for (const deployment of deployments) {
    const rToken = await hre.ethers.getContractAt('RTokenP1', deployment.rToken)
    console.log('\n', await rToken.symbol())

    const alexios = await hre.ethers.getContractAt('Governance', deployment.governor)
    const step1 = await proposal_3_4_0_step_1(
      hre,
      deployment.rToken,
      alexios.address,
      deployment.timelock,
      spell.address
    )
    step1.rtoken = deployment.rToken
    step1.governor = alexios.address
    step1.timelock = deployment.timelock

    let descHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(step1.description))
    step1.proposalId = BigNumber.from(
      await alexios.hashProposal(step1.targets, step1.values, step1.calldatas, descHash)
    ).toString()

    fs.writeFileSync(
      `./tasks/validation/proposals/proposal-${step1.proposalId}.json`,
      JSON.stringify(step1, null, 4)
    )

    await hre.run('proposal-validator', {
      proposalid: step1.proposalId,
    })

    const timelock = await hre.ethers.getContractAt('TimelockController', deployment.timelock)
    if (
      (await timelock.hasRole(PROPOSER_ROLE, alexios.address)) ||
      (await timelock.hasRole(EXECUTOR_ROLE, alexios.address)) ||
      (await timelock.hasRole(CANCELLER_ROLE, alexios.address))
    ) {
      throw new Error('governor rekt')
    }
    if ((await rToken.version()) != '3.4.0') throw new Error('Failed to upgrade to 3.4.0')

    // All registered collateral should be SOUND
    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    const assetRegistry = await hre.ethers.getContractAt(
      'AssetRegistryP1',
      await main.assetRegistry()
    )
    const [, assets] = await assetRegistry.getRegistry()
    for (const asset of assets) {
      const coll = await hre.ethers.getContractAt('ICollateral', asset)
      if ((await coll.isCollateral()) && (await coll.status()) != 0) {
        throw new Error(`coll ${coll.address} is not SOUND: ${await coll.status()}`)
      }
    }

    console.log('Part 2')

    const anastasius = await hre.ethers.getContractAt(
      'Governance',
      await spell.anastasiuses(deployment.rToken)
    )
    const step2 = await proposal_3_4_0_step_2(
      hre,
      deployment.rToken,
      anastasius.address,
      deployment.timelock,
      spell.address
    )

    step2.rtoken = deployment.rToken
    step2.governor = anastasius.address
    step2.timelock = deployment.timelock

    descHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(step2.description))
    step2.proposalId = BigNumber.from(
      await anastasius.hashProposal(step2.targets, step2.values, step2.calldatas, descHash)
    ).toString()

    fs.writeFileSync(
      `./tasks/validation/proposals/proposal-${step2.proposalId}.json`,
      JSON.stringify(step2, null, 4)
    )

    await hre.run('proposal-validator', {
      proposalid: step2.proposalId,
    })
  }
})
