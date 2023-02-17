import { task, types } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../scripts/deployment/common'
import fs from 'fs'

interface Artifact {
    contractName: String
    abi: Func[]
}

interface Func {
    name: String
}

task('print-invariants', 'Prints the invariant names for each fuzzing scenario')
  .setAction(async (params, hre) => {
    const artifactsPath = 'artifacts/contracts/fuzz/scenarios/'
    let normalArtifact: Artifact
    let chaosArtifact: Artifact
    let rebalancingArtifact: Artifact
    try {
        normalArtifact = <Artifact>JSON.parse(await fs.readFileSync(`${artifactsPath}NormalOps.sol/NormalOpsScenario.json`, 'utf-8'))
        chaosArtifact = <Artifact>JSON.parse(await fs.readFileSync(`${artifactsPath}ChaosOps.sol/ChaosOpsScenario.json`, 'utf-8'))
        rebalancingArtifact = <Artifact>JSON.parse(await fs.readFileSync(`${artifactsPath}Rebalancing.sol/RebalancingScenario.json`, 'utf-8'))
    } catch {
        throw Error('nope')
    }

    function printInvariants(artifact: Artifact) {
        console.log(`Invariants for [${artifact.contractName}]:`)
        const abi = artifact.abi
        for (const i in abi) {
            const a = abi[Number(i)]
            if (a.name && a.name.includes('echidna')) console.log(a.name)
        }
        console.log('\n')
    }

    printInvariants(normalArtifact)
    printInvariants(chaosArtifact)
    printInvariants(rebalancingArtifact)
  })
