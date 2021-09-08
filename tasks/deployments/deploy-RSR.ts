import { task } from "hardhat/config"
import { getChainId } from "../../common/blockchain-utils"

task("deploy-RSR", "Deploy RSR contract")
    .addParam("prevrsr", "Contract address of the previous RSR implementation")
    .addParam("slowwallet", "Address of the slow wallet")
    .addParam("multisigwallet", "Address of the multisig wallet")
    .setAction(async ({ prevrsr, slowwallet, multisigwallet }, hre) => {
        const [deployer] = await hre.ethers.getSigners()
        const chainId = await getChainId(hre)

        // Deploy RSR contract
        console.log("* Deploying RSR contract")

        const RSR = await hre.ethers.getContractFactory("RSR")
        const rsr = await RSR.connect(deployer).deploy(prevrsr, slowwallet, multisigwallet)

        await rsr.deployed()

        console.log(
            `RSR deployed at address: ${rsr.address} on network ${hre.network.name} (${chainId}).`
        )
        console.log(`Tx: ${rsr.deployTransaction.hash}\n`)

        // Return deployed address
        return { rsrAddr: rsr.address }
    })
