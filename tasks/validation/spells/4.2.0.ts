import fs from 'fs'
import { task } from 'hardhat/config'
import { BigNumber } from 'ethers'
import { useEnv } from '#/utils/env'
import { BASE_DEPLOYMENTS, MAINNET_DEPLOYMENTS } from '../utils/constants'
import { resetFork } from '#/utils/chain'
import {
  proposal_4_2_0,
  EXECUTOR_ROLE,
  PROPOSER_ROLE,
  CANCELLER_ROLE,
  MAIN_OWNER_ROLE,
} from '../proposals/4_2_0'
import { Upgrade4_2_0 } from '#/typechain'

// Use this once to serialize a proposal
task('4.2.0', 'Upgrade to 4.2.0').setAction(async (_, hre) => {
  const network = useEnv('FORK_NETWORK').toLowerCase()
  const block = useEnv('FORK_BLOCK')

  const deployments = network === 'base' ? BASE_DEPLOYMENTS : MAINNET_DEPLOYMENTS
  for (const deployment of deployments) {
    // reset fork
    await resetFork(hre, Number(block))

    const rToken = await hre.ethers.getContractAt('RTokenP1', deployment.rToken)
    console.log(
      '\n',
      `/*****  4.2.0 Upgrade - RToken: ${await rToken.symbol()} - Address: ${rToken.address} ****/`
    )

    // TODO remove and replace with canonical spell address after deployment
    let spell: Upgrade4_2_0
    {
      const FacadeWriteLibFactory = await hre.ethers.getContractFactory('FacadeWriteLib')
      const facadeWriteLib = await FacadeWriteLibFactory.deploy()
      await facadeWriteLib.deployed()

      const UpgradeFactory = await hre.ethers.getContractFactory('Upgrade4_2_0', {
        libraries: {
          FacadeWriteLib: facadeWriteLib.address,
        },
      })
      spell = await UpgradeFactory.deploy(network !== 'base')
      await spell.deployed()
    }

    const anastasius = await hre.ethers.getContractAt('Governance', deployment.governor)
    const result = await proposal_4_2_0(
      hre,
      deployment.rToken,
      anastasius.address,
      deployment.timelock,
      spell.address
    )
    result.rtoken = deployment.rToken
    result.governor = anastasius.address
    result.timelock = deployment.timelock

    const descHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(result.description))
    result.proposalId = BigNumber.from(
      await anastasius.hashProposal(result.targets, result.values, result.calldatas, descHash)
    ).toString()

    fs.writeFileSync(
      `./tasks/validation/proposals/proposal-${result.proposalId}.json`,
      JSON.stringify(result, null, 4)
    )

    await hre.run('proposal-validator', {
      proposalid: result.proposalId,
    })

    const [newAnastasiusAddr, newTimelockAddr] = await spell.newGovs(deployment.rToken)
    console.log(`New governor: ${newAnastasiusAddr}, new timelock: ${newTimelockAddr}`)

    const newTimelock = await hre.ethers.getContractAt('TimelockController', newTimelockAddr)

    if (
      (await newTimelock.hasRole(PROPOSER_ROLE, anastasius.address)) ||
      (await newTimelock.hasRole(EXECUTOR_ROLE, anastasius.address)) ||
      (await newTimelock.hasRole(CANCELLER_ROLE, anastasius.address))
    ) {
      throw new Error('governor rekt')
    }

    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    if (
      (await main.hasRole(MAIN_OWNER_ROLE, spell.address)) ||
      (await main.hasRole(MAIN_OWNER_ROLE, deployment.timelock)) ||
      !(await main.hasRole(MAIN_OWNER_ROLE, newTimelock.address))
    ) {
      throw new Error('RToken rekt')
    }
    if ((await rToken.version()) != '4.2.0') throw new Error('Failed to upgrade to 4.2.0')

    // All registered collateral should be SOUND
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
  }
})
