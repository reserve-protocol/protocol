const { getChainId } = require("../../../common/blockchain-utils");

task("deploy-ReserveRightsTokenMock", "Deploys previous RSR Mock contract")
    .setAction(async taskArgs => {
        const [deployer] = await ethers.getSigners();
        const chainId = await getChainId();

        console.log("* Deploying RSR Mock contract")

        // Previous RSR Contract
        RSRMock = await ethers.getContractFactory("ReserveRightsTokenMock");
        prevRSR = await RSRMock.connect(deployer).deploy("Reserve Rights", "RSR");

        await prevRSR.deployed();

        console.log(`Previous RSR Mock contract deployed at address: ${prevRSR.address} on network ${network.name} (${chainId})`);
        console.log(`Tx: ${prevRSR.deployTransaction.hash}\n`);

        return ({ previousRSRAddr: prevRSR.address });
    })

module.exports = {}

