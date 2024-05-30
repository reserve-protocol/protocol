import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { Contract } from 'ethers'

let spell: Contract

task('deploy-spell', 'Deploys a spell by name')
  // version is unusable as a param name
  .addParam('semver', 'Semantic version string to deploy, such as "3.4.0"', '', types.string)
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)
    const isMainnet = chainId === '1'

    const version = params.semver.replaceAll('.', '_')
    const spellName = `Upgrade${version}`

    if (!params.noOutput) {
      console.log(
        `Deploying Spell ${spellName} to ${hre.network.name} with isMainnet ${isMainnet} and chainId (${chainId}) with burner account ${wallet.address}`
      )
    }

    // Deploy Spell
    const SpellFactory = await hre.ethers.getContractFactory(spellName)
    spell = await SpellFactory.deploy(isMainnet)

    if (!params.noOutput) {
      console.log(
        `Deployed Spell ${spellName} to ${hre.network.name} with isMainnet ${isMainnet} and chainId (${chainId}): ${spell.address}`
      )
    }

    // Uncomment to verify
    if (!params.noOutput) {
      console.log('sleeping 15s')
    }

    // Sleep to ensure API is in sync with chain
    await new Promise((r) => setTimeout(r, 15000)) // 15s

    /** ******************** Verify Spell ****************************************/
    console.time('Verifying Spell Implementation')
    await hre.run('verify:verify', {
      address: spell.address,
      constructorArguments: [isMainnet],
      contract: `contracts/spells/${version}.sol:Upgrade${version}`,
    })
    console.timeEnd('Verifying Spell Implementation')

    if (!params.noOutput) {
      console.log('verified')
    }

    return { spell: spell.address }
  })
