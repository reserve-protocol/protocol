const { getChainId } = require("../../common/blockchain-utils");

task("deploy-RSR", "Deploy RSR contract")
    .addParam("prevrsr", "Contract address of the previous RSR implementation")
    .addParam("slowwallet", "Address of the slow wallet")
    .addParam("multisigwallet", "Address of the multisig wallet")
    .setAction(async ({ prevrsr, slowwallet, multisigwallet }) => {
        const [deployer] = await ethers.getSigners();
        const chainId = await getChainId();

        // Deploy RSR contract
        console.log("* Deploying RSR contract")

        RSR = await ethers.getContractFactory("RSR");
        rsr = await RSR.connect(deployer).deploy(prevrsr, slowwallet, multisigwallet), {
            gasLimit: 10000000
        };

        await rsr.deployed();

        console.log(`RSR deployed at address: ${rsr.address} on network ${network.name} (${chainId}).`);
        console.log(`Tx: ${rsr.deployTransaction.hash}\n`);

        // Return deployed address
        return ({ rsrAddr: rsr.address });
    })

module.exports = {}
