import { task } from "hardhat/config"
import { getChainId } from "../../../common/blockchain-utils"

task("deploy-ReserveRightsTokenMock", "Deploys previous RSR Mock contract").setAction(
    async (taskArgs, hre) => {
        const [deployer] = await hre.ethers.getSigners()
        const chainId = await getChainId(hre)

        console.log("* Deploying RSR Mock contract")

        // Previous RSR Contract
        const RSRMock = await hre.ethers.getContractFactory("ReserveRightsTokenMock")
        const prevRSR = await RSRMock.connect(deployer).deploy("Reserve Rights", "RSR")

        await prevRSR.deployed()

        console.log(
            `Previous RSR Mock contract deployed at address: ${prevRSR.address} on network ${hre.network.name} (${chainId})`
        )
        console.log(`Tx: ${prevRSR.deployTransaction.hash}\n`)

        return { previousRSRAddr: prevRSR.address }
    }
)

module.exports = {}
